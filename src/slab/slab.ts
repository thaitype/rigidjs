import type { StructDef, StructFields, Handle, ColumnKey, ColumnType } from '../types.js'
import { generateSoAHandleClass } from '../struct/handle-codegen.js'
import type { ColumnRef } from '../struct/handle-codegen.js'
import { bitmapByteLength, bitmapSet, bitmapClear, bitmapGet } from './bitmap.js'

export type { Handle }

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Fixed-capacity, slot-reusing container.
 *
 * All returned handles are the SAME object instance — do not hold references
 * past the next insert() / get() / remove() call without copying field values
 * out into JS primitives first.
 *
 * Storage strategy (milestone-3): Structure-of-Arrays (SoA) layout.
 * One ArrayBuffer holds all columns end-to-end. Each column occupies a
 * contiguous TypedArray sub-view of `capacity` elements. Handles use
 * TypedArray indexed access — no DataView, no per-slot byte arithmetic at
 * field-access time.
 */
export interface Slab<F extends StructFields> {
  /**
   * Fill the next free slot and return the shared reusable handle rebased to
   * that slot.
   *
   * @throws "slab at capacity" if no free slots remain.
   * @throws "slab has been dropped" after drop().
   */
  insert(): Handle<F>

  /**
   * Free the slot at the given numeric index.
   *
   * @throws "slot X out of range" if slot is out of [0, capacity).
   * @throws "slot X already free" on double-free.
   * @throws "slab has been dropped" after drop().
   */
  remove(slot: number): void

  /**
   * Rebase the shared handle to slot `index`. Does NOT check occupancy.
   * Use has() for occupancy checks.
   *
   * @throws "slab: index out of range" if index is invalid.
   * @throws "slab has been dropped" after drop().
   */
  get(index: number): Handle<F>

  /**
   * Return true iff the given numeric slot is currently occupied.
   *
   * @throws "slot X out of range" if slot is out of [0, capacity).
   * @throws "slab has been dropped" after drop().
   */
  has(slot: number): boolean

  /** Number of currently occupied slots. */
  readonly len: number

  /** Maximum number of slots. */
  readonly capacity: number

  /** Mark every slot free; rebuild the free-list. Keeps the buffer. */
  clear(): void

  /** Release the underlying buffer. All subsequent operations throw. */
  drop(): void

  /** Underlying ArrayBuffer — escape hatch for power users. Read-only reference. */
  readonly buffer: ArrayBuffer

  /**
   * Returns the pre-built TypedArray column view for the named column.
   *
   * Allocation-free: views are pre-constructed at slab creation time and
   * stored in a Map keyed by dotted column name (e.g. 'pos.x', 'life').
   * Call this ONCE before a hot loop and iterate the returned TypedArray directly.
   *
   * `column(name).buffer === slab.buffer` is guaranteed (same ArrayBuffer).
   *
   * @throws "unknown column: <name>" for invalid column names.
   * @throws "slab has been dropped" after drop().
   */
  column<K extends ColumnKey<F>>(name: K): ColumnType<F, K>

  /**
   * Iterate over all occupied slots, calling `cb` with the shared handle
   * rebased to each occupied slot and the slot number.
   *
   * Internal counted loop — no iterator protocol overhead.
   * The same handle instance is passed to every invocation; do NOT store
   * references to it past the current callback invocation.
   *
   * Unoccupied slots (holes in the free-list) are skipped automatically.
   * No early-exit support — forEach always runs to completion.
   *
   * @throws "slab has been dropped" after drop().
   */
  forEach(cb: (handle: Handle<F>, slot: number) => void): void
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fixed-capacity slab container for the given struct definition.
 *
 * Storage layout (SoA — milestone-3):
 *   - Exactly ONE `ArrayBuffer` of size `sizeofPerSlot * capacity`.
 *   - Columns are laid out in natural-alignment order (largest element size first),
 *     guaranteeing every TypedArray view is properly aligned without padding.
 *     Column i starts at byte `column[i].byteOffset * capacity` in the buffer.
 *   - One TypedArray sub-view per column: `new TypedArrayCtor(buf, byteOffset * capacity, capacity)`.
 *   - One reusable handle instance built by generateSoAHandleClass with closure-captured column refs.
 *   - Rebasing is slot-only: `_rebase(slot)` — no DataView, no byte arithmetic.
 *
 * @param def       A StructDef produced by struct().
 * @param capacity  Positive integer — maximum number of simultaneous entries.
 * @throws if capacity is not a positive integer.
 * @throws if def._Handle is absent (def was not produced by struct()).
 */
export function slab<F extends StructFields>(
  def: StructDef<F>,
  capacity: number,
): Slab<F> {
  // --- Validation ---
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error('slab: capacity must be a positive integer')
  }
  if (!def._columnLayout) {
    throw new Error('slab: StructDef has no _columnLayout — was it created by struct()?')
  }

  // --- Compute column layout ---
  // Use the pre-computed layout from def._columnLayout (already done at struct() time).
  // This avoids re-running the layout computation on every slab() call.
  const layout = def._columnLayout

  // --- Single ArrayBuffer allocation ---
  // Total bytes = sizeofPerSlot * capacity.
  // (sizeofPerSlot is the sum of all column element sizes, invariant to SoA vs AoS.)
  const _buf = new ArrayBuffer(layout.sizeofPerSlot * capacity)

  // --- Build one TypedArray sub-view per column ---
  //
  // SoA buffer layout (capacity = N, columns sorted largest-first):
  //   [col0: byteOffset=0,  length=N] [col1: byteOffset=8, length=N] ...
  //
  // The byte start of column i in the buffer is: column[i].byteOffset * capacity.
  // This is because byteOffset is the per-slot byte offset within a "sizeof" slice,
  // and in SoA we lay out capacity elements of column i contiguously before column i+1.
  //
  // Alignment invariant (from task-2 §2):
  //   The natural-alignment sort guarantees that for every column i,
  //   (byteOffset[i] * capacity) is a multiple of elementSize[i].
  //   Proof: byteOffset[i] is already a multiple of elementSize[i] (proven by the sort),
  //   and multiplying by any integer preserves divisibility.
  //   Therefore new TypedArrayCtor(buf, byteOffset * capacity, capacity) will never throw
  //   an alignment error. We assert this at runtime as a belt-and-suspenders check.
  const _columnMap = new Map<string, Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array>()
  const columnRefs = new Map<string, ColumnRef>()

  for (const col of layout.columns) {
    const bufByteOffset = col.byteOffset * capacity

    // Alignment assertion: bufByteOffset must be a multiple of col.elementSize.
    // This follows from the task-2 alignment invariant: byteOffset is a multiple of
    // elementSize (natural-alignment sort), and multiplying by capacity preserves that.
    // If this assertion fires, the column layout has an alignment bug.
    if (bufByteOffset % col.elementSize !== 0) {
      throw new Error(
        `slab: alignment violation for column '${col.name}': ` +
        `bufByteOffset=${bufByteOffset} is not a multiple of elementSize=${col.elementSize}. ` +
        `This violates the task-2 natural-alignment invariant.`,
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypedArray ctor is a union; any is required to call new
    const array = new (col.typedArrayCtor as any)(_buf, bufByteOffset, capacity) as
      Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array

    _columnMap.set(col.name, array)
    columnRefs.set(col.name, { name: col.name, array })
  }

  // --- Build the reusable SoA handle ---
  // generateSoAHandleClass builds a class whose field getters/setters do pure TypedArray
  // indexed access: `this._c_pos_x[this._slot]`. Column TypedArrays are captured in the
  // class closure at construction time — no per-call lookup, no allocation.
  const HandleClass = generateSoAHandleClass(layout.handleTree, columnRefs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SoAHandleConstructor returns `object`; any isolates the bridge
  const _handle = new (HandleClass as any)(0) as Handle<F>

  // --- Bitmap + free-list ---
  // Pre-allocated Uint32Array stack: avoids JS Array push/pop GC overhead.
  // Fill descending so freeList[capacity-1] = 0, freeList[capacity-2] = 1, ...
  // _freeTop starts at capacity; --_freeTop before read gives slot 0 first.
  const _bits = new Uint8Array(bitmapByteLength(capacity))
  let _freeList: Uint32Array | null = new Uint32Array(capacity)
  let _freeTop = capacity
  for (let i = 0; i < capacity; i++) _freeList[i] = capacity - 1 - i

  let _len = 0
  let _dropped = false

  // Helper created once at slab() call time — single closure allocation, not per-call.
  function assertLive(): void {
    if (_dropped) throw new Error('slab has been dropped')
  }

  // ---------------------------------------------------------------------------
  // Return the slab as a plain object literal with getters where needed.
  // Closures are created once here (slab() call time), never inside hot paths.
  // ---------------------------------------------------------------------------
  return {
    insert(): Handle<F> {
      assertLive()
      if (_freeTop === 0) throw new Error('slab at capacity')
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds-checked: _freeTop > 0 and _freeList is live
      const slot = _freeList![--_freeTop]!
      bitmapSet(_bits, slot)
      _len++
      // SoA _rebase takes only (slot) — no DataView, no byte offset.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is generated and not in static TS type
      ;((_handle as any)._rebase(slot))
      return _handle
    },

    remove(slot: number): void {
      assertLive()
      if (!Number.isInteger(slot) || slot < 0 || slot >= capacity) {
        throw new Error(`slot ${slot} out of range`)
      }
      if (!bitmapGet(_bits, slot)) {
        throw new Error(`slot ${slot} already free`)
      }
      bitmapClear(_bits, slot)
      _freeList![_freeTop++] = slot
      _len--
    },

    get(index: number): Handle<F> {
      assertLive()
      if (!Number.isInteger(index) || index < 0 || index >= capacity) {
        throw new Error('slab: index out of range')
      }
      // SoA _rebase takes only (slot) — same boundary as insert().
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same boundary as insert()
      ;((_handle as any)._rebase(index))
      return _handle
    },

    has(slot: number): boolean {
      assertLive()
      if (!Number.isInteger(slot) || slot < 0 || slot >= capacity) {
        throw new Error(`slot ${slot} out of range`)
      }
      return bitmapGet(_bits, slot)
    },

    get len(): number {
      assertLive()
      return _len
    },

    get capacity(): number {
      assertLive()
      return capacity
    },

    clear(): void {
      assertLive()
      _bits.fill(0)
      _freeTop = capacity
      for (let i = 0; i < capacity; i++) _freeList![i] = capacity - 1 - i
      _len = 0
    },

    drop(): void {
      assertLive()
      _dropped = true
      // Null out internal references so GC can reclaim them.
      _freeList = null
    },

    get buffer(): ArrayBuffer {
      assertLive()
      return _buf
    },

    column<K extends ColumnKey<F>>(name: K): ColumnType<F, K> {
      assertLive()
      const arr = _columnMap.get(name)
      if (arr === undefined) {
        throw new Error(`unknown column: ${name}`)
      }
      // The runtime TypedArray subclass for this column was determined by the column's
      // numeric token at slab construction time and is guaranteed to match ColumnType<F, K>
      // by the layout invariants established in task-2 (see computeColumnLayout).
      return arr as unknown as ColumnType<F, K>
    },

    forEach(cb: (handle: Handle<F>, slot: number) => void): void {
      assertLive()
      // Internal counted loop — no iterator protocol, no per-call allocation.
      // Reuses the single shared handle instance by rebasing it to each occupied slot.
      for (let i = 0; i < capacity; i++) {
        if (!bitmapGet(_bits, i)) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is generated and not in static TS type
        ;((_handle as any)._rebase(i))
        cb(_handle, i)
      }
    },
  }
}
