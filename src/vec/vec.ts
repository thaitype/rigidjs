import type { StructDef, StructFields, Handle, ColumnKey, ColumnType } from '../types.js'
import { computeColumnLayout } from '../struct/layout.js'
import { generateSoAHandleClass } from '../struct/handle-codegen.js'
import type { ColumnRef } from '../struct/handle-codegen.js'
import { generateJSObjectFactory, generateJSHandleClass, generateCopyToColumnsFn } from './js-codegen.js'

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

  /**
   * The current storage mode: 'js' (plain JS objects) or 'soa' (TypedArray columns).
   *
   * Starts as 'js' when no initialCapacity is given, and transitions to 'soa'
   * automatically when len reaches the graduation threshold (default 128),
   * or immediately when .graduate() or .column() is called.
   *
   * Once 'soa', the mode never reverts to 'js'.
   */
  readonly mode: 'js' | 'soa'

  /**
   * True when the vec has graduated to SoA mode (mode === 'soa').
   */
  readonly isGraduated: boolean

  /**
   * Force immediate graduation from JS mode to SoA mode, regardless of current len.
   * No-op if already in SoA mode.
   *
   * After graduation:
   * - buffer is accessible
   * - column() returns TypedArrays directly
   * - All JS object data is preserved and readable via SoA handles
   */
  graduate(): void
}

// ---------------------------------------------------------------------------
// Options API
// ---------------------------------------------------------------------------

/**
 * Options for configuring the vec storage mode and graduation behavior.
 *
 * | Call | Mode | Graduation |
 * |------|------|------------|
 * | `vec(T)` | JS, graduates at 128 | auto |
 * | `vec(T, 100)` | SoA immediately, capacity=100 | N/A (already SoA) |
 * | `vec(T, { capacity: 100 })` | SoA immediately, capacity=100 | N/A |
 * | `vec(T, { mode: 'soa' })` | SoA immediately, capacity=16 | N/A |
 * | `vec(T, { mode: 'js' })` | JS permanently | never |
 * | `vec(T, { graduateAt: 256 })` | JS, graduates at 256 | auto |
 * | `vec(T, { mode: 'soa', capacity: 1000 })` | SoA, capacity=1000 | N/A |
 * | `vec(T, { mode: 'js', graduateAt: 256 })` | JS permanently (graduateAt ignored) | never |
 */
export interface VecOptions {
  /**
   * Pre-allocate SoA capacity. Implies mode: 'soa' — no point starting in JS mode
   * if you already know the required size.
   * Must be a positive integer.
   */
  capacity?: number
  /**
   * Force a specific storage mode.
   * - 'soa': start in SoA mode immediately (default capacity 16 if not specified)
   * - 'js': stay in JS mode permanently, never auto-graduate
   */
  mode?: 'js' | 'soa'
  /**
   * Custom graduation threshold for hybrid mode (default 128).
   * The vec auto-graduates to SoA when len reaches this value.
   * Only applies when mode is not explicitly set ('js' or 'soa').
   * Must be a positive integer.
   */
  graduateAt?: number
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a growable vec container for the given struct definition.
 *
 * Modes:
 *   - `vec(def)` — hybrid mode: starts in JS mode (plain JS objects, low init cost),
 *     auto-graduates to SoA when len reaches the graduation threshold (default 128).
 *   - `vec(def, capacity)` — backward compat: starts in SoA mode with given capacity.
 *   - `vec(def, options)` — full options API; see VecOptions for all combinations.
 *
 * SoA storage layout (identical to slab):
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
 * @param def   A StructDef produced by struct().
 * @param opts  Optional: number (backward compat capacity) or VecOptions object.
 * @throws if capacity is not a positive integer (when provided).
 * @throws if graduateAt is not a positive integer (when provided).
 * @throws if mode === 'js' and capacity is also set (contradictory options).
 * @throws if def._columnLayout is absent (def was not produced by struct()).
 */
export function vec<F extends StructFields>(
  def: StructDef<F>,
  opts?: number | VecOptions,
): Vec<F> {
  // ---------------------------------------------------------------------------
  // Parse options
  // ---------------------------------------------------------------------------
  let resolvedMode: 'js' | 'soa' | 'hybrid' = 'hybrid'
  let initialCapacity: number | undefined
  let graduateAt = 128

  if (typeof opts === 'number') {
    // Backward compat: vec(T, 16) → SoA mode, capacity=16
    resolvedMode = 'soa'
    initialCapacity = opts
  } else if (opts !== undefined) {
    // Validate contradictory options before anything else
    if (opts.mode === 'js' && opts.capacity !== undefined) {
      throw new Error('vec: cannot combine mode "js" with capacity (capacity implies SoA mode)')
    }

    if (opts.mode === 'soa' || opts.capacity !== undefined) {
      resolvedMode = 'soa'
      initialCapacity = opts.capacity
    } else if (opts.mode === 'js') {
      resolvedMode = 'js'  // permanent JS mode — never graduate
    }
    // else: resolvedMode stays 'hybrid'

    if (opts.graduateAt !== undefined) {
      if (!Number.isInteger(opts.graduateAt) || opts.graduateAt <= 0) {
        throw new Error('vec: graduateAt must be a positive integer')
      }
      graduateAt = opts.graduateAt
    }
  }

  // ---------------------------------------------------------------------------
  // Determine internal jsMode flag and _graduateAt
  // ---------------------------------------------------------------------------
  // jsMode=true  → start with JS objects (hybrid or permanent-js)
  // jsMode=false → start with SoA TypedArray columns immediately
  const jsMode = resolvedMode !== 'soa'
  // _graduateAt: threshold for auto-graduation in hybrid mode.
  // Infinity disables auto-graduation (permanent JS mode).
  const _graduateAt = resolvedMode === 'js' ? Infinity : graduateAt

  if (!jsMode) {
    // --- Validation for SoA mode ---
    if (initialCapacity !== undefined && (!Number.isInteger(initialCapacity) || initialCapacity <= 0)) {
      throw new Error('vec: capacity must be a positive integer')
    }
  }

  // --- Compute column layout (needed for SoA mode) ---
  // Use the pre-computed layout from def._columnLayout if available;
  // otherwise fall back to computing it (supports calling vec() with a raw StructDef).
  const layout = def._columnLayout ?? computeColumnLayout(def.fields)

  // ---------------------------------------------------------------------------
  // Shared state
  // ---------------------------------------------------------------------------

  let _len = 0
  let _dropped = false
  // Mode starts as 'js' when no initialCapacity is given.
  // Transitions to 'soa' on graduation (auto at threshold, or explicit .graduate()/.column()).
  // Once 'soa', never reverts to 'js'.
  let _mode: 'soa' | 'js' = jsMode ? 'js' : 'soa'

  // Helper created once at vec() call time — single closure allocation, not per-call.
  function assertLive(): void {
    if (_dropped) throw new Error('vec has been dropped')
  }

  // ---------------------------------------------------------------------------
  // JS mode state
  // ---------------------------------------------------------------------------

  // _items: plain JS objects backing store for JS mode.
  // Only used when _mode === 'js'.
  let _items: object[] = jsMode ? [] : (null as unknown as object[])

  // Reusable JS handle (rebased per operation, never allocated per-call).
  // Only used when _mode === 'js'.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSHandleConstructor returns `object`; any isolates the bridge
  const JSHandleClass = jsMode ? generateJSHandleClass(def.fields) : (null as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _jsHandle: any = jsMode ? new (JSHandleClass as any)({}) : null

  // Factory function to create JS objects with stable hidden class.
  // Only used when _mode === 'js'.
  const _createJSObject: (() => object) | null = jsMode ? generateJSObjectFactory(def.fields) : null

  // ---------------------------------------------------------------------------
  // SoA mode state
  // ---------------------------------------------------------------------------

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

  // Default SoA capacity when mode: 'soa' is forced without an explicit capacity.
  const SOA_DEFAULT_CAPACITY = 16
  const soaInitialCapacity = jsMode ? 0 : (initialCapacity ?? SOA_DEFAULT_CAPACITY)

  // SoA-only state — initialized to null in JS mode to avoid unnecessary allocation.
  let _buf: ArrayBuffer = jsMode ? (null as unknown as ArrayBuffer) : new ArrayBuffer(layout.sizeofPerSlot * soaInitialCapacity)
  let _capacity: number = jsMode ? 0 : soaInitialCapacity
  let _columnMap = new Map<string, AnyTypedArray>()
  let columnRefs = new Map<string, ColumnRef>()
  // Pre-extracted column arrays for allocation-free hot-path access in swapRemove/remove.
  // Kept in sync with _columnMap on every buildColumns() call.
  let _columnArrays: AnyTypedArray[] = []

  // Codegen-unrolled swap function for swapRemove hot path.
  // Generated via new Function() at construction time and on every growth/reserve event.
  // eslint-disable-next-line prefer-const -- reassigned in buildColumns
  let _swapFn: (index: number, lastIndex: number) => void = () => {}

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

  // --- Build the reusable SoA handle ---
  // generateSoAHandleClass builds a class whose field getters/setters do pure TypedArray
  // indexed access: `this._c_pos_x[this._slot]`. Column TypedArrays are captured in the
  // class closure at construction time.
  let HandleClass = jsMode ? (null as unknown as ReturnType<typeof generateSoAHandleClass>) : (
    // Only build columns and handle in SoA mode.
    (buildColumns(_buf, _capacity), generateSoAHandleClass(layout.handleTree, columnRefs))
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SoAHandleConstructor returns `object`; any isolates the bridge
  let _handle: Handle<F> = jsMode ? (null as unknown as Handle<F>) : new (HandleClass as any)(0) as Handle<F>

  /**
   * Grow the SoA backing buffer to 2x capacity.
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

  /**
   * Transition from JS mode to SoA mode (graduation).
   *
   * Steps:
   *  1. Compute initial SoA capacity: max(_len * 2, DEFAULT_CAPACITY) — give room to grow.
   *  2. Allocate ArrayBuffer(layout.sizeofPerSlot * soaCapacity).
   *  3. buildColumns(newBuf, soaCapacity) — builds TypedArray views and columnRefs.
   *  4. Copy data from _items JS objects into columns via codegen'd copyToColumns function.
   *  5. Generate SoA handle class via generateSoAHandleClass.
   *  6. Create new handle instance.
   *  7. Release JS objects (_items = null) and switch _mode = 'soa'.
   *
   * This is called:
   *  - Automatically from push() when _len >= _graduateAt.
   *  - From column() when _mode === 'js' (user wants TypedArray, implies SoA).
   *  - From graduate() directly.
   */
  function graduateToSoA(): void {
    // Step 1: compute initial SoA capacity — at least 2x current len, min 128.
    const DEFAULT_CAPACITY = 128
    const soaCapacity = Math.max(_len * 2, DEFAULT_CAPACITY)

    // Step 2: allocate new buffer.
    const newBuf = new ArrayBuffer(layout.sizeofPerSlot * soaCapacity)

    // Step 3: build column TypedArrays over the new buffer.
    // buildColumns populates _columnMap, columnRefs, and _columnArrays.
    buildColumns(newBuf, soaCapacity)

    // Step 4: copy data from JS objects into TypedArray columns.
    // generateCopyToColumnsFn produces a codegen'd function that iterates
    // once and copies each field to its column TypedArray.
    const copyFn = generateCopyToColumnsFn(def.fields, columnRefs)
    copyFn(_items, _len)

    // Step 5+6: generate SoA handle class and create handle instance.
    HandleClass = generateSoAHandleClass(layout.handleTree, columnRefs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _handle = new (HandleClass as any)(0) as Handle<F>

    // Step 7: switch mode and release JS objects.
    _buf = newBuf
    _capacity = soaCapacity
    _mode = 'soa'
    _items = null as unknown as object[]
  }

  // ---------------------------------------------------------------------------
  // Return the vec as a plain object literal with getters where needed.
  // Closures are created once here (vec() call time), never inside hot paths.
  // ---------------------------------------------------------------------------
  return {
    push(): Handle<F> {
      assertLive()
      if (_mode === 'soa') {
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
        // JS mode: create a plain JS object and push into _items.
        const obj = _createJSObject!()
        _items.push(obj)
        _jsHandle._rebase(obj)
        _jsHandle._slot = _len
        _len++
        // Auto-graduation: when len reaches the threshold, switch to SoA mode.
        // The item just pushed is included in _items before graduation runs, so
        // all data (including this new item) is copied to SoA columns.
        if (_len >= _graduateAt) {
          graduateToSoA()
          // After graduation, _handle is the SoA handle. Rebase it to the slot
          // of the item we just pushed.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is code-generated
          ;((_handle as any)._rebase(_len - 1))
          return _handle
        }
        return _jsHandle as Handle<F>
      }
    },

    pop(): void {
      assertLive()
      if (_mode === 'soa') {
        if (_len === 0) {
          throw new Error('vec is empty')
        }
        _len--
      } else {
        // JS mode
        if (_len === 0) {
          throw new Error('vec is empty')
        }
        _items.pop()
        _len--
      }
    },

    get(index: number): Handle<F> {
      assertLive()
      if (_mode === 'soa') {
        if (index < 0 || index >= _len) {
          throw new Error('index out of range')
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same bridge as push()
        ;((_handle as any)._rebase(index))
        return _handle
      } else {
        // JS mode
        if (index < 0 || index >= _len) {
          throw new Error('index out of range')
        }
        _jsHandle._rebase(_items[index]!)
        _jsHandle._slot = index
        return _jsHandle as Handle<F>
      }
    },

    swapRemove(index: number): void {
      assertLive()
      if (_mode === 'soa') {
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
        // JS mode
        if (index < 0 || index >= _len) {
          throw new Error('index out of range')
        }
        const last = _len - 1
        // Move the last item to the removed slot.
        // When index === last, this is a self-assignment (harmless).
        _items[index] = _items[last]!
        _items.pop()
        _len--
      }
    },

    remove(index: number): void {
      assertLive()
      if (_mode === 'soa') {
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
        // JS mode
        if (index < 0 || index >= _len) {
          throw new Error('index out of range')
        }
        _items.splice(index, 1)
        _len--
      }
    },

    get len(): number {
      return _len
    },

    get capacity(): number {
      if (_mode === 'js') {
        // JS arrays grow automatically; capacity === len in JS mode.
        return _len
      }
      return _capacity
    },

    clear(): void {
      assertLive()
      if (_mode === 'js') {
        _items.length = 0
      }
      _len = 0
    },

    drop(): void {
      assertLive()
      _dropped = true
      if (_mode === 'js') {
        // Null out _items so GC can reclaim the objects.
        _items = null as unknown as object[]
      } else {
        // Null out internal references so GC can reclaim them.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this as any)._buf = null
      }
    },

    get buffer(): ArrayBuffer {
      assertLive()
      if (_mode === 'js') {
        // buffer is not available in JS mode — but we keep this guard for
        // vecs that are permanently in JS mode (mode: 'js' option, task-4).
        throw new Error('buffer not available in JS mode')
      }
      return _buf
    },

    column<K extends ColumnKey<F>>(name: K): ColumnType<F, K> {
      assertLive()
      if (_mode === 'js') {
        // Auto-graduate: caller clearly wants TypedArray (SoA) data.
        // This is a one-time cost — subsequent column() calls are free.
        graduateToSoA()
      }
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
        // JS mode iterator
        let cursor = 0
        return {
          next(): IteratorResult<Handle<F>> {
            assertLive()
            if (cursor < _len) {
              _jsHandle._rebase(_items[cursor]!)
              _jsHandle._slot = cursor
              cursor++
              return { value: _jsHandle as Handle<F>, done: false }
            }
            return { value: undefined as unknown as Handle<F>, done: true }
          },
        }
      }
    },

    forEach(cb: (handle: Handle<F>, index: number) => void): void {
      assertLive()
      if (_mode === 'soa') {
        // Internal counted loop — no iterator protocol, no per-call allocation.
        // Reuses the single shared handle instance by rebasing it to each index.
        for (let i = 0; i < _len; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is generated and not in static TS type
          ;((_handle as any)._rebase(i))
          cb(_handle, i)
        }
      } else {
        // JS mode: loop _items, rebase JSHandle to each.
        for (let i = 0; i < _len; i++) {
          _jsHandle._rebase(_items[i]!)
          _jsHandle._slot = i
          cb(_jsHandle as Handle<F>, i)
        }
      }
    },

    reserve(n: number): void {
      assertLive()
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error('vec.reserve: n must be a positive integer')
      }
      if (_mode === 'js') {
        // JS arrays grow automatically — reserve is a no-op in JS mode.
        return
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

    get mode(): 'js' | 'soa' {
      return _mode
    },

    get isGraduated(): boolean {
      return _mode === 'soa'
    },

    graduate(): void {
      assertLive()
      if (_mode === 'js') {
        graduateToSoA()
      }
    },
  }
}
