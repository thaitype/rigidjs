import type { StructDef, StructFields, Handle, ColumnKey, ColumnType } from '../types.js'
import { computeColumnLayout } from '../struct/layout.js'
import { generateSoAHandleClass } from '../struct/handle-codegen.js'
import type { ColumnRef } from '../struct/handle-codegen.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Growable, ordered, densely-packed container for structs.
 *
 * Vec stores elements contiguously from index 0 to len-1 with no holes.
 * When capacity is exceeded on push(), the backing ArrayBuffer is
 * reallocated at 2x capacity and all columns are copied via
 * TypedArray.set().
 *
 * All returned handles are the SAME object instance — do not hold
 * references past the next push() / get() call without copying field
 * values into JS primitives first.
 *
 * Storage strategy: Structure-of-Arrays (SoA) layout, identical to slab.
 * One ArrayBuffer holds all columns end-to-end. Each column occupies a
 * contiguous TypedArray sub-view of `capacity` elements. Handles use
 * TypedArray indexed access — no DataView, no per-slot byte arithmetic at
 * field-access time.
 */
export interface Vec<F extends StructFields> {
  /**
   * Append a new element at the end. Returns the shared handle rebased
   * to the new slot (index len-1 after push).
   *
   * In task-1: if len === capacity, throws "vec is full".
   * (Task-2 replaces this with 2x growth.)
   *
   * @throws "vec is full" if len === capacity (task-1 only).
   * @throws "vec has been dropped" after drop().
   */
  push(): Handle<F>

  /**
   * Remove the last element. Decrements len by 1.
   *
   * @throws "vec is empty" if len === 0.
   * @throws "vec has been dropped" after drop().
   */
  pop(): void

  /**
   * Rebase the shared handle to the given index and return it.
   *
   * @param index - Must be in [0, len).
   * @throws "index out of range" if index >= len or index < 0.
   * @throws "vec has been dropped" after drop().
   */
  get(index: number): Handle<F>

  /** Current element count (0 <= len <= capacity). */
  readonly len: number

  /** Current buffer capacity in element count. */
  readonly capacity: number

  /**
   * Reset len to 0. Keeps the buffer and capacity unchanged.
   * Existing data is not zeroed — it becomes inaccessible via the API
   * but remains in the buffer until overwritten by future push() calls.
   *
   * @throws "vec has been dropped" after drop().
   */
  clear(): void

  /**
   * Release the underlying ArrayBuffer. All subsequent operations throw
   * "vec has been dropped".
   */
  drop(): void

  /**
   * The single underlying ArrayBuffer.
   *
   * @throws "vec has been dropped" after drop().
   */
  readonly buffer: ArrayBuffer

  /**
   * Return the pre-built TypedArray view for the named column.
   *
   * The name space is the same flattened dotted-key space as slab.column().
   * The returned view spans [0, capacity) elements. Only indices [0, len)
   * contain valid data.
   *
   * @throws "vec has been dropped" after drop().
   * @throws "unknown column: <name>" if name is not a valid column key.
   */
  column<K extends ColumnKey<F>>(name: K): ColumnType<F, K>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_CAPACITY = 16

/**
 * Create a fixed-capacity (task-1) vec container for the given struct definition.
 *
 * Storage layout (SoA — identical to slab):
 *   - Exactly ONE `ArrayBuffer` of size `sizeofPerSlot * capacity`.
 *   - Columns are laid out in natural-alignment order (largest element size first).
 *   - One TypedArray sub-view per column: `new TypedArrayCtor(buf, byteOffset * capacity, capacity)`.
 *   - One reusable handle instance built by generateSoAHandleClass.
 *   - Rebasing is slot-only: `_rebase(slot)`.
 *
 * @param def              A StructDef produced by struct().
 * @param initialCapacity  Starting capacity. Defaults to 16.
 * @throws if initialCapacity is not a positive integer (when provided).
 * @throws if def._columnLayout is absent (def was not produced by struct()).
 */
export function vec<F extends StructFields>(
  def: StructDef<F>,
  initialCapacity?: number,
): Vec<F> {
  const capacity = initialCapacity ?? DEFAULT_CAPACITY

  // --- Validation ---
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error('vec: initialCapacity must be a positive integer')
  }

  // --- Compute column layout ---
  // Use the pre-computed layout from def._columnLayout if available;
  // otherwise fall back to computing it (supports calling vec() with a raw StructDef).
  const layout = def._columnLayout ?? computeColumnLayout(def.fields)

  // --- Single ArrayBuffer allocation ---
  // Total bytes = sizeofPerSlot * capacity.
  let _buf = new ArrayBuffer(layout.sizeofPerSlot * capacity)
  let _capacity = capacity

  // --- Build one TypedArray sub-view per column ---
  //
  // SoA buffer layout (capacity = N, columns sorted largest-first):
  //   [col0: byteOffset=0, length=N] [col1: byteOffset=8, length=N] ...
  //
  // The byte start of column i in the buffer is: column[i].byteOffset * capacity.
  // This is the same formula used by slab.
  type AnyTypedArray =
    | Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array
    | Int32Array | Int16Array | Int8Array

  let _columnMap = new Map<string, AnyTypedArray>()
  let columnRefs = new Map<string, ColumnRef>()

  function buildColumns(buf: ArrayBuffer, cap: number): void {
    _columnMap = new Map()
    columnRefs = new Map()
    for (const col of layout.columns) {
      const bufByteOffset = col.byteOffset * cap

      // Alignment assertion — same rationale as slab.
      if (bufByteOffset % col.elementSize !== 0) {
        throw new Error(
          `vec: alignment violation for column '${col.name}': ` +
          `bufByteOffset=${bufByteOffset} is not a multiple of elementSize=${col.elementSize}.`,
        )
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypedArray ctor is a union; any is required to call new
      const array = new (col.typedArrayCtor as any)(buf, bufByteOffset, cap) as AnyTypedArray

      _columnMap.set(col.name, array)
      columnRefs.set(col.name, { name: col.name, array })
    }
  }

  buildColumns(_buf, _capacity)

  // --- Build the reusable SoA handle ---
  // generateSoAHandleClass builds a class whose field getters/setters do pure TypedArray
  // indexed access: `this._c_pos_x[this._slot]`. Column TypedArrays are captured in the
  // class closure at construction time.
  const HandleClass = generateSoAHandleClass(layout.handleTree, columnRefs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SoAHandleConstructor returns `object`; any isolates the bridge
  const _handle = new (HandleClass as any)(0) as Handle<F>

  let _len = 0
  let _dropped = false

  // Helper created once at vec() call time — single closure allocation, not per-call.
  function assertLive(): void {
    if (_dropped) throw new Error('vec has been dropped')
  }

  // ---------------------------------------------------------------------------
  // Return the vec as a plain object literal with getters where needed.
  // Closures are created once here (vec() call time), never inside hot paths.
  // ---------------------------------------------------------------------------
  return {
    push(): Handle<F> {
      assertLive()
      if (_len >= _capacity) {
        throw new Error('vec is full')
      }
      const slot = _len
      _len++
      // SoA _rebase takes only (slot) — no DataView, no byte offset.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is generated and not in static TS type
      ;((_handle as any)._rebase(slot))
      return _handle
    },

    pop(): void {
      assertLive()
      if (_len === 0) {
        throw new Error('vec is empty')
      }
      _len--
    },

    get(index: number): Handle<F> {
      assertLive()
      if (index < 0 || index >= _len) {
        throw new Error('index out of range')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same bridge as push()
      ;((_handle as any)._rebase(index))
      return _handle
    },

    get len(): number {
      return _len
    },

    get capacity(): number {
      return _capacity
    },

    clear(): void {
      assertLive()
      _len = 0
    },

    drop(): void {
      assertLive()
      _dropped = true
      // Null out internal references so GC can reclaim them.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this as any)._buf = null
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
      // numeric token at vec construction time and is guaranteed to match ColumnType<F, K>.
      return arr as unknown as ColumnType<F, K>
    },
  }
}
