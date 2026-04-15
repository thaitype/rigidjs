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
 *
 * IMPORTANT: After a growth event (triggered by push()), all previously
 * returned column() references and the buffer reference become stale.
 * Always re-resolve column() and buffer after any push() that might trigger
 * growth. This is the same pattern as C++ vector iterator invalidation.
 */
export interface Vec<F extends StructFields> {
  /**
   * Append a new element at the end. Returns the shared handle rebased
   * to the new slot (index len-1 after push).
   *
   * If len === capacity, the vec grows: a new ArrayBuffer at 2x capacity
   * is allocated, all columns are copied via TypedArray.set(), and all
   * internal column refs are updated. Previously returned column()
   * references become stale -- do NOT cache them across push() calls
   * that might trigger growth.
   *
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

  /**
   * O(1) removal: copy all column values from the last element (len-1)
   * into the slot at index, then decrement len. The element that was at
   * len-1 now occupies index. Order changes.
   *
   * If index === len-1, this is equivalent to pop().
   *
   * This is the primary "remove from middle" API for hot-path code where
   * order does not matter. Use remove() instead when order must be preserved.
   *
   * @param index - Must be in [0, len).
   * @throws "index out of range" if index >= len or index < 0.
   * @throws "vec has been dropped" after drop().
   */
  swapRemove(index: number): void

  /**
   * O(n) removal: shift all elements after index left by one position
   * across all columns using TypedArray.copyWithin(), then decrement len.
   * Order is preserved.
   *
   * This is the slow path for order-preserving removal. Use swapRemove()
   * instead when order does not matter.
   *
   * @param index - Must be in [0, len).
   * @throws "index out of range" if index >= len or index < 0.
   * @throws "vec has been dropped" after drop().
   */
  remove(index: number): void

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
   * The single underlying ArrayBuffer. Changes on growth (new buffer
   * is allocated). Do NOT cache this reference across push() calls
   * that might trigger growth.
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
   * IMPORTANT: After a growth event (triggered by push()), all previously
   * returned column() references point at the OLD buffer and are stale.
   * Always re-resolve column() after any push() that might trigger growth.
   *
   * @throws "vec has been dropped" after drop().
   * @throws "unknown column: <name>" if name is not a valid column key.
   */
  column<K extends ColumnKey<F>>(name: K): ColumnType<F, K>

  /**
   * Iterate over all elements from index 0 to len-1.
   *
   * The iterator yields the shared handle rebased to each successive
   * index. The SAME handle instance is yielded at every step -- users
   * must NOT store references to the yielded handle past the current
   * iteration step. Capture primitive values (handle.slot, field values)
   * if you need them after the loop advances.
   *
   * The iterator allocates one iterator object per for..of call.
   * Each next() call is allocation-free (rebases the existing handle).
   *
   * @throws "vec has been dropped" on first call to next() after drop().
   */
  [Symbol.iterator](): Iterator<Handle<F>>

  /**
   * Iterate over all elements from index 0 to len-1, calling `cb` with
   * the shared handle rebased to each index and the index number.
   *
   * Internal counted loop — no iterator protocol overhead.
   * The same handle instance is passed to every invocation; do NOT store
   * references to it past the current callback invocation.
   *
   * No early-exit support — forEach always runs to completion.
   *
   * @throws "vec has been dropped" after drop().
   */
  forEach(cb: (handle: Handle<F>, index: number) => void): void

  /**
   * Ensure the vec has capacity for at least `n` total elements.
   *
   * If the current capacity >= n, this is a no-op.
   * If the current capacity < n, the backing buffer is reallocated to
   * exactly `n` capacity (same growth mechanism as push overflow, but
   * targeting `n` instead of 2x). All existing elements are preserved.
   * Previously returned column() references become stale after growth.
   *
   * @param n - Target minimum capacity. Must be a positive integer.
   * @throws "vec has been dropped" after drop().
   * @throws "vec.reserve: n must be a positive integer" for invalid input.
   */
  reserve(n: number): void
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_CAPACITY = 16

/**
 * Create a growable vec container for the given struct definition.
 *
 * Storage layout (SoA — identical to slab):
 *   - Exactly ONE `ArrayBuffer` of size `sizeofPerSlot * capacity`.
 *   - Columns are laid out in natural-alignment order (largest element size first).
 *   - One TypedArray sub-view per column: `new TypedArrayCtor(buf, byteOffset * capacity, capacity)`.
 *   - One reusable handle instance built by generateSoAHandleClass.
 *   - Rebasing is slot-only: `_rebase(slot)`.
 *
 * Growth strategy (Strategy A — re-create handle on growth):
 *   When push() overflows capacity, a new 2x-capacity ArrayBuffer is allocated,
 *   column data is copied via TypedArray.set(), then generateSoAHandleClass() is
 *   called again with the new column refs to produce a new handle. One allocation
 *   per growth event. Column refs captured in the handle closure are always current.
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
  // Pre-extracted column arrays for allocation-free hot-path access in swapRemove/remove.
  // Kept in sync with _columnMap on every buildColumns() call.
  let _columnArrays: AnyTypedArray[] = []

  // Codegen-unrolled swap function for swapRemove hot path.
  // Generated via new Function() at construction time and on every growth/reserve event.
  // Column count is known at vec() call time, so we unroll the per-column copy loop
  // into N direct TypedArray writes: c0[i]=c0[last]; c1[i]=c1[last]; ...
  // This eliminates the generic loop overhead and allows JSC to inline each write.
  // Benchmarks: ~9x faster than the generic loop for 3-column structs in isolation.
  let _swapFn: (index: number, lastIndex: number) => void

  /**
   * Generate an unrolled swapRemove inner function for the given column arrays.
   *
   * Uses new Function() (same technique as handle codegen) to produce a closure
   * that captures each TypedArray directly by variable name, avoiding the
   * outer array deref (_columnArrays[c]) on every call.
   *
   * Each call to buildColumns() produces a new closure capturing the new TypedArrays.
   * One allocation per construction/growth event — never inside swapRemove itself.
   */
  function generateSwapFn(arrays: AnyTypedArray[]): (index: number, lastIndex: number) => void {
    if (arrays.length === 0) {
      // Zero-column struct: swap is a no-op.
      return function noopSwap(_index: number, _lastIndex: number): void {}
    }
    // Build parameter list: c0, c1, c2, ...
    const params = arrays.map((_, i) => `c${i}`).join(', ')
    // Build unrolled body: one line per column.
    let body = ''
    for (let i = 0; i < arrays.length; i++) {
      body += `  c${i}[index] = c${i}[lastIndex];\n`
    }
    // eslint-disable-next-line no-new-func -- intentional codegen; same pattern as handle-codegen.ts
    const factory = new Function(params, `return function unrolledSwap(index, lastIndex) {\n${body}}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- factory is runtime-generated
    return (factory as any)(...arrays) as (index: number, lastIndex: number) => void
  }

  function buildColumns(buf: ArrayBuffer, cap: number): void {
    _columnMap = new Map()
    columnRefs = new Map()
    _columnArrays = []
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
      _columnArrays.push(array)
    }
    // Regenerate the unrolled swap function to capture the new TypedArray instances.
    // One new Function() call per construction/growth event — not per swapRemove call.
    _swapFn = generateSwapFn(_columnArrays)
  }

  buildColumns(_buf, _capacity)

  // --- Build the reusable SoA handle ---
  // generateSoAHandleClass builds a class whose field getters/setters do pure TypedArray
  // indexed access: `this._c_pos_x[this._slot]`. Column TypedArrays are captured in the
  // class closure at construction time.
  let HandleClass = generateSoAHandleClass(layout.handleTree, columnRefs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SoAHandleConstructor returns `object`; any isolates the bridge
  let _handle = new (HandleClass as any)(0) as Handle<F>

  let _len = 0
  let _dropped = false

  // ---------------------------------------------------------------------------
  // Mode dispatch — GATE EXPERIMENT (milestone-7 task-1)
  //
  // _mode is initialized once at construction to 'soa' and never changed.
  // This makes it a compile-time constant from the JIT's perspective after
  // warmup: the branch prediction sees a monomorphic path and the dead 'js'
  // branch is elided. The experiment measures whether this branch adds any
  // measurable overhead at large scale (>2% regression = FAIL).
  //
  // The else path throws intentionally — it will never execute during benchmarks
  // or tests. If _mode were ever set to 'js' it would hit an unimplemented guard.
  // ---------------------------------------------------------------------------
  const _mode: 'soa' | 'js' = 'soa'

  // Helper created once at vec() call time — single closure allocation, not per-call.
  function assertLive(): void {
    if (_dropped) throw new Error('vec has been dropped')
  }

  /**
   * Grow the backing buffer to 2x capacity.
   *
   * Steps:
   *  1. Compute newCapacity = _capacity * 2.
   *  2. Allocate new ArrayBuffer.
   *  3. Build new column TypedArrays over the new buffer.
   *  4. Copy existing data from old columns to new columns via TypedArray.set().
   *  5. Update _buf and _capacity.
   *  6. Re-create the handle via Strategy A: call generateSoAHandleClass() again
   *     with the new column refs to produce a new handle whose closure captures
   *     the new TypedArrays. Rebases the new handle to current _len before push.
   *
   * Strategy A is chosen because mutating column TypedArray fields on an existing
   * handle object (Strategy B / _rebindColumns) causes JSC JIT deoptimization:
   * the JIT profiles field types as stable and deoptimizes when they change.
   * Re-creating the handle once per growth event keeps each handle instance
   * monomorphic throughout its lifetime, enabling full JIT specialization.
   */
  function grow(): void {
    const newCapacity = _capacity * 2
    const newBuf = new ArrayBuffer(layout.sizeofPerSlot * newCapacity)

    // Snapshot old columns before rebuilding.
    const oldColumnArrays = _columnArrays.slice()

    // Build new columns over the new buffer.
    buildColumns(newBuf, newCapacity)

    // Copy all existing data from old columns to new columns.
    // TypedArray.set(source) copies the entire source array into the target
    // starting at offset 0 — one native call per column.
    for (let c = 0; c < _columnArrays.length; c++) {
      _columnArrays[c]!.set(oldColumnArrays[c]!)
    }

    // Update internal state.
    _buf = newBuf
    _capacity = newCapacity

    // Re-create handle with new column refs (Strategy A).
    // The old HandleClass and old _handle become unreferenced and GC-collectable.
    HandleClass = generateSoAHandleClass(layout.handleTree, columnRefs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _handle = new (HandleClass as any)(0) as Handle<F>
  }

  // ---------------------------------------------------------------------------
  // Return the vec as a plain object literal with getters where needed.
  // Closures are created once here (vec() call time), never inside hot paths.
  // ---------------------------------------------------------------------------
  return {
    push(): Handle<F> {
      if (_mode === 'soa') {
        assertLive()
        if (_len >= _capacity) {
          grow()
        }
        const slot = _len
        _len++
        // SoA _rebase takes only (slot) — no DataView, no byte offset.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is generated and not in static TS type
        ;((_handle as any)._rebase(slot))
        return _handle
      } else {
        throw new Error('not implemented: js mode')
      }
    },

    pop(): void {
      if (_mode === 'soa') {
        assertLive()
        if (_len === 0) {
          throw new Error('vec is empty')
        }
        _len--
      } else {
        throw new Error('not implemented: js mode')
      }
    },

    get(index: number): Handle<F> {
      if (_mode === 'soa') {
        assertLive()
        if (index < 0 || index >= _len) {
          throw new Error('index out of range')
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same bridge as push()
        ;((_handle as any)._rebase(index))
        return _handle
      } else {
        throw new Error('not implemented: js mode')
      }
    },

    swapRemove(index: number): void {
      if (_mode === 'soa') {
        assertLive()
        if (index < 0 || index >= _len) {
          throw new Error('index out of range')
        }
        // Copy all column values from last element into index.
        // When index === _len - 1, this is a self-assignment (harmless).
        // _swapFn is a codegen-unrolled function (generated via new Function() at
        // construction/growth time) that writes each column directly without a loop.
        _swapFn(index, _len - 1)
        _len--
      } else {
        throw new Error('not implemented: js mode')
      }
    },

    remove(index: number): void {
      if (_mode === 'soa') {
        assertLive()
        if (index < 0 || index >= _len) {
          throw new Error('index out of range')
        }
        // Shift all elements after index left by one position.
        // TypedArray.copyWithin handles overlapping ranges correctly.
        // Use pre-extracted _columnArrays to avoid Map.get() per column per call.
        for (let c = 0; c < _columnArrays.length; c++) {
          _columnArrays[c]!.copyWithin(index, index + 1, _len)
        }
        _len--
      } else {
        throw new Error('not implemented: js mode')
      }
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

    [Symbol.iterator](): Iterator<Handle<F>> {
      if (_mode === 'soa') {
        // One iterator object allocated per for..of call.
        // Each next() call rebases the shared handle — zero allocation per step.
        let cursor = 0
        return {
          next(): IteratorResult<Handle<F>> {
            assertLive()
            if (cursor < _len) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is code-generated
              ;((_handle as any)._rebase(cursor))
              cursor++
              return { value: _handle, done: false }
            }
            return { value: undefined as unknown as Handle<F>, done: true }
          },
        }
      } else {
        throw new Error('not implemented: js mode')
      }
    },

    forEach(cb: (handle: Handle<F>, index: number) => void): void {
      if (_mode === 'soa') {
        assertLive()
        // Internal counted loop — no iterator protocol, no per-call allocation.
        // Reuses the single shared handle instance by rebasing it to each index.
        for (let i = 0; i < _len; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is generated and not in static TS type
          ;((_handle as any)._rebase(i))
          cb(_handle, i)
        }
      } else {
        throw new Error('not implemented: js mode')
      }
    },

    reserve(n: number): void {
      assertLive()
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error('vec.reserve: n must be a positive integer')
      }
      // No-op if already large enough.
      if (_capacity >= n) return

      // Grow to exactly n.
      const newBuf = new ArrayBuffer(layout.sizeofPerSlot * n)

      // Snapshot old columns before rebuilding.
      const oldColumnArrays = _columnArrays.slice()

      // Build new columns over the new buffer.
      buildColumns(newBuf, n)

      // Copy existing data from old columns to new columns.
      for (let c = 0; c < _columnArrays.length; c++) {
        _columnArrays[c]!.set(oldColumnArrays[c]!)
      }

      // Update internal state.
      _buf = newBuf
      _capacity = n

      // Re-create handle with new column refs (Strategy A) — same as grow().
      HandleClass = generateSoAHandleClass(layout.handleTree, columnRefs)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _handle = new (HandleClass as any)(0) as Handle<F>
    },
  }
}
