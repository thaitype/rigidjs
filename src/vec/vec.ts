import type { StructDef, StructFields, Handle, ColumnKey, ColumnType } from '../types.js'
import { computeColumnLayout } from '../struct/layout.js'
import { generateSoAHandleClass } from '../struct/handle-codegen.js'
import type { ColumnRef } from '../struct/handle-codegen.js'
import { generateJSObjectFactory, generateCopyToColumnsFn } from './js-codegen.js'

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
// Internal TypedArray union type
// ---------------------------------------------------------------------------

type AnyTypedArray =
  | Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array
  | Int32Array | Int16Array | Int8Array

// ---------------------------------------------------------------------------
// VecImpl class
// Prototype-defined methods and getters eliminate per-call defineProperty()
// overhead that the old object-literal approach incurred (~230 ns/call).
// ---------------------------------------------------------------------------

class VecImpl<F extends StructFields> implements Vec<F> {
  // Shared state
  private _len = 0
  private _dropped = false
  private _mode: 'soa' | 'js'
  private _graduateAt: number

  // JS mode state
  private _items: object[] | null
  private _createJSObject: (() => object) | null

  // SoA mode state
  private _buf: ArrayBuffer | null
  private _capacity: number
  private _columnMap: Map<string, AnyTypedArray>
  private _columnRefs: Map<string, ColumnRef>
  private _columnArrays: AnyTypedArray[]
  private _swapFn: (index: number, lastIndex: number) => void
  private _HandleClass: ReturnType<typeof generateSoAHandleClass> | null
  private _handle: Handle<F> | null

  // Layout is shared across instances via def._columnLayout
  private readonly _layout: ReturnType<typeof computeColumnLayout>
  private readonly _def: StructDef<F>

  constructor(def: StructDef<F>, opts?: number | VecOptions) {
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
    this._graduateAt = resolvedMode === 'js' ? Infinity : graduateAt

    if (!jsMode) {
      // --- Validation for SoA mode ---
      if (initialCapacity !== undefined && (!Number.isInteger(initialCapacity) || initialCapacity <= 0)) {
        throw new Error('vec: capacity must be a positive integer')
      }
    }

    // --- Compute column layout (needed for SoA mode) ---
    // Use the pre-computed layout from def._columnLayout if available;
    // otherwise fall back to computing it (supports calling vec() with a raw StructDef).
    this._layout = def._columnLayout ?? computeColumnLayout(def.fields)
    this._def = def

    // ---------------------------------------------------------------------------
    // Initialize mode
    // ---------------------------------------------------------------------------
    this._mode = jsMode ? 'js' : 'soa'

    // ---------------------------------------------------------------------------
    // Initialize JS mode state
    // ---------------------------------------------------------------------------
    if (jsMode) {
      this._items = []
      // Cache factory on StructDef so codegen runs at most once per struct definition.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutable internal cache field
      if (!(def as any)._JSFactory) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutable internal cache field
        ;(def as any)._JSFactory = generateJSObjectFactory(def.fields)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutable internal cache field
      this._createJSObject = (def as any)._JSFactory as () => object
    } else {
      this._items = null
      this._createJSObject = null
    }

    // ---------------------------------------------------------------------------
    // Initialize SoA mode state
    // ---------------------------------------------------------------------------

    // Default SoA capacity when mode: 'soa' is forced without an explicit capacity.
    const SOA_DEFAULT_CAPACITY = 16
    const soaInitialCapacity = jsMode ? 0 : (initialCapacity ?? SOA_DEFAULT_CAPACITY)

    this._columnMap = new Map()
    this._columnRefs = new Map()
    this._columnArrays = []
    this._swapFn = () => {}
    this._HandleClass = null
    this._handle = null

    if (!jsMode) {
      this._buf = new ArrayBuffer(this._layout.sizeofPerSlot * soaInitialCapacity)
      this._capacity = soaInitialCapacity
      this._buildColumns(this._buf, this._capacity)
      this._HandleClass = generateSoAHandleClass(this._layout.handleTree, this._columnRefs)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._handle = new (this._HandleClass as any)(0) as Handle<F>
    } else {
      this._buf = null
      this._capacity = 0
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _assertLive(): void {
    if (this._dropped) throw new Error('vec has been dropped')
  }

  /**
   * Generate an unrolled swapRemove inner function for the given column arrays.
   *
   * Uses new Function() (same technique as handle codegen) to produce a closure
   * that captures each TypedArray directly by variable name, avoiding the
   * outer array deref (_columnArrays[c]) on every call.
   *
   * Each call to _buildColumns() produces a new closure capturing the new TypedArrays.
   * One allocation per construction/growth event — never inside swapRemove itself.
   */
  private static _generateSwapFn(arrays: AnyTypedArray[]): (index: number, lastIndex: number) => void {
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

  private _buildColumns(buf: ArrayBuffer, cap: number): void {
    this._columnMap = new Map()
    this._columnRefs = new Map()
    this._columnArrays = []
    for (const col of this._layout.columns) {
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

      this._columnMap.set(col.name, array)
      this._columnRefs.set(col.name, { name: col.name, array })
      this._columnArrays.push(array)
    }
    // Regenerate the unrolled swap function to capture the new TypedArray instances.
    // One new Function() call per construction/growth event — not per swapRemove call.
    this._swapFn = VecImpl._generateSwapFn(this._columnArrays)
  }

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
  private _grow(): void {
    const newCapacity = this._capacity * 2
    const newBuf = new ArrayBuffer(this._layout.sizeofPerSlot * newCapacity)

    // Snapshot old columns before rebuilding.
    const oldColumnArrays = this._columnArrays.slice()

    // Build new columns over the new buffer.
    this._buildColumns(newBuf, newCapacity)

    // Copy all existing data from old columns to new columns.
    // TypedArray.set(source) copies the entire source array into the target
    // starting at offset 0 — one native call per column.
    for (let c = 0; c < this._columnArrays.length; c++) {
      this._columnArrays[c]!.set(oldColumnArrays[c]!)
    }

    // Update internal state.
    this._buf = newBuf
    this._capacity = newCapacity

    // Re-create handle with new column refs (Strategy A).
    // The old _HandleClass and old _handle become unreferenced and GC-collectable.
    this._HandleClass = generateSoAHandleClass(this._layout.handleTree, this._columnRefs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._handle = new (this._HandleClass as any)(0) as Handle<F>
  }

  /**
   * Transition from JS mode to SoA mode (graduation).
   *
   * Steps:
   *  1. Compute initial SoA capacity: max(_len * 2, DEFAULT_CAPACITY) — give room to grow.
   *  2. Allocate ArrayBuffer(layout.sizeofPerSlot * soaCapacity).
   *  3. _buildColumns(newBuf, soaCapacity) — builds TypedArray views and columnRefs.
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
  private _graduateToSoA(): void {
    // Step 1: compute initial SoA capacity — at least 2x current len, min 128.
    const DEFAULT_CAPACITY = 128
    const soaCapacity = Math.max(this._len * 2, DEFAULT_CAPACITY)

    // Step 2: allocate new buffer.
    const newBuf = new ArrayBuffer(this._layout.sizeofPerSlot * soaCapacity)

    // Step 3: build column TypedArrays over the new buffer.
    // _buildColumns populates _columnMap, _columnRefs, and _columnArrays.
    this._buildColumns(newBuf, soaCapacity)

    // Step 4: copy data from JS objects into TypedArray columns.
    // generateCopyToColumnsFn produces a codegen'd function that iterates
    // once and copies each field to its column TypedArray.
    const copyFn = generateCopyToColumnsFn(this._def.fields, this._columnRefs)
    copyFn(this._items!, this._len)

    // Step 5+6: generate SoA handle class and create handle instance.
    this._HandleClass = generateSoAHandleClass(this._layout.handleTree, this._columnRefs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._handle = new (this._HandleClass as any)(0) as Handle<F>

    // Step 7: switch mode and release JS objects.
    this._buf = newBuf
    this._capacity = soaCapacity
    this._mode = 'soa'
    this._items = null
  }

  // ---------------------------------------------------------------------------
  // Public methods (on prototype — no per-instance defineProperty() cost)
  // ---------------------------------------------------------------------------

  push(): Handle<F> {
    this._assertLive()
    if (this._mode === 'soa') {
      if (this._len >= this._capacity) {
        this._grow()
      }
      const slot = this._len
      this._len++
      // SoA _rebase takes only (slot) — no DataView, no byte offset.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is generated and not in static TS type
      ;((this._handle as any)._rebase(slot))
      return this._handle!
    } else {
      // JS mode: create a plain JS object and push into _items.
      // The plain JS object IS the handle — no wrapper needed.
      const obj = this._createJSObject!()
      this._items!.push(obj)
      this._len++
      // Auto-graduation: when len reaches the threshold, switch to SoA mode.
      // The item just pushed is included in _items before graduation runs, so
      // all data (including this new item) is copied to SoA columns.
      if (this._len >= this._graduateAt) {
        this._graduateToSoA()
        // After graduation, _handle is the SoA handle. Rebase it to the slot
        // of the item we just pushed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is code-generated
        ;((this._handle as any)._rebase(this._len - 1))
        return this._handle!
      }
      return obj as unknown as Handle<F>
    }
  }

  pop(): void {
    this._assertLive()
    if (this._mode === 'soa') {
      if (this._len === 0) {
        throw new Error('vec is empty')
      }
      this._len--
    } else {
      // JS mode
      if (this._len === 0) {
        throw new Error('vec is empty')
      }
      this._items!.pop()
      this._len--
    }
  }

  get(index: number): Handle<F> {
    this._assertLive()
    if (this._mode === 'soa') {
      if (index < 0 || index >= this._len) {
        throw new Error('index out of range')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same bridge as push()
      ;((this._handle as any)._rebase(index))
      return this._handle!
    } else {
      // JS mode: return the plain JS object directly
      if (index < 0 || index >= this._len) {
        throw new Error('index out of range')
      }
      return this._items![index] as unknown as Handle<F>
    }
  }

  swapRemove(index: number): void {
    this._assertLive()
    if (this._mode === 'soa') {
      if (index < 0 || index >= this._len) {
        throw new Error('index out of range')
      }
      // Copy all column values from last element into index.
      // When index === _len - 1, this is a self-assignment (harmless).
      // _swapFn is a codegen-unrolled function (generated via new Function() at
      // construction/growth time) that writes each column directly without a loop.
      this._swapFn(index, this._len - 1)
      this._len--
    } else {
      // JS mode
      if (index < 0 || index >= this._len) {
        throw new Error('index out of range')
      }
      const last = this._len - 1
      // Move the last item to the removed slot.
      // When index === last, this is a self-assignment (harmless).
      this._items![index] = this._items![last]!
      this._items!.pop()
      this._len--
    }
  }

  remove(index: number): void {
    this._assertLive()
    if (this._mode === 'soa') {
      if (index < 0 || index >= this._len) {
        throw new Error('index out of range')
      }
      // Shift all elements after index left by one position.
      // TypedArray.copyWithin handles overlapping ranges correctly.
      // Use pre-extracted _columnArrays to avoid Map.get() per column per call.
      for (let c = 0; c < this._columnArrays.length; c++) {
        this._columnArrays[c]!.copyWithin(index, index + 1, this._len)
      }
      this._len--
    } else {
      // JS mode
      if (index < 0 || index >= this._len) {
        throw new Error('index out of range')
      }
      this._items!.splice(index, 1)
      this._len--
    }
  }

  get len(): number {
    return this._len
  }

  get capacity(): number {
    if (this._mode === 'js') {
      // JS arrays grow automatically; capacity === len in JS mode.
      return this._len
    }
    return this._capacity
  }

  clear(): void {
    this._assertLive()
    if (this._mode === 'js') {
      this._items!.length = 0
    }
    this._len = 0
  }

  drop(): void {
    this._assertLive()
    this._dropped = true
    if (this._mode === 'js') {
      // Null out _items so GC can reclaim the objects.
      this._items = null
    } else {
      // Null out internal references so GC can reclaim them.
      this._buf = null
    }
  }

  get buffer(): ArrayBuffer {
    this._assertLive()
    if (this._mode === 'js') {
      // buffer is not available in JS mode — but we keep this guard for
      // vecs that are permanently in JS mode (mode: 'js' option, task-4).
      throw new Error('buffer not available in JS mode')
    }
    return this._buf!
  }

  column<K extends ColumnKey<F>>(name: K): ColumnType<F, K> {
    this._assertLive()
    if (this._mode === 'js') {
      // Auto-graduate: caller clearly wants TypedArray (SoA) data.
      // This is a one-time cost — subsequent column() calls are free.
      this._graduateToSoA()
    }
    const arr = this._columnMap.get(name)
    if (arr === undefined) {
      throw new Error(`unknown column: ${name}`)
    }
    // The runtime TypedArray subclass for this column was determined by the column's
    // numeric token at vec construction time and is guaranteed to match ColumnType<F, K>.
    return arr as unknown as ColumnType<F, K>
  }

  [Symbol.iterator](): Iterator<Handle<F>> {
    if (this._mode === 'soa') {
      // One iterator object allocated per for..of call.
      // Each next() call rebases the shared handle — zero allocation per step.
      let cursor = 0
      const self = this
      return {
        next(): IteratorResult<Handle<F>> {
          self._assertLive()
          if (cursor < self._len) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is code-generated
            ;((self._handle as any)._rebase(cursor))
            cursor++
            return { value: self._handle!, done: false }
          }
          return { value: undefined as unknown as Handle<F>, done: true }
        },
      }
    } else {
      // JS mode iterator: yield plain JS objects directly
      let cursor = 0
      const self = this
      return {
        next(): IteratorResult<Handle<F>> {
          self._assertLive()
          if (cursor < self._len) {
            const obj = self._items![cursor]!
            cursor++
            return { value: obj as unknown as Handle<F>, done: false }
          }
          return { value: undefined as unknown as Handle<F>, done: true }
        },
      }
    }
  }

  forEach(cb: (handle: Handle<F>, index: number) => void): void {
    this._assertLive()
    if (this._mode === 'soa') {
      // Internal counted loop — no iterator protocol, no per-call allocation.
      // Reuses the single shared handle instance by rebasing it to each index.
      for (let i = 0; i < this._len; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- _rebase is generated and not in static TS type
        ;((this._handle as any)._rebase(i))
        cb(this._handle!, i)
      }
    } else {
      // JS mode: pass plain JS objects directly — no wrapper needed.
      for (let i = 0; i < this._len; i++) {
        cb(this._items![i] as unknown as Handle<F>, i)
      }
    }
  }

  reserve(n: number): void {
    this._assertLive()
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error('vec.reserve: n must be a positive integer')
    }
    if (this._mode === 'js') {
      // JS arrays grow automatically — reserve is a no-op in JS mode.
      return
    }
    // No-op if already large enough.
    if (this._capacity >= n) return

    // Grow to exactly n.
    const newBuf = new ArrayBuffer(this._layout.sizeofPerSlot * n)

    // Snapshot old columns before rebuilding.
    const oldColumnArrays = this._columnArrays.slice()

    // Build new columns over the new buffer.
    this._buildColumns(newBuf, n)

    // Copy existing data from old columns to new columns.
    for (let c = 0; c < this._columnArrays.length; c++) {
      this._columnArrays[c]!.set(oldColumnArrays[c]!)
    }

    // Update internal state.
    this._buf = newBuf
    this._capacity = n

    // Re-create handle with new column refs (Strategy A) — same as _grow().
    this._HandleClass = generateSoAHandleClass(this._layout.handleTree, this._columnRefs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._handle = new (this._HandleClass as any)(0) as Handle<F>
  }

  get mode(): 'js' | 'soa' {
    return this._mode
  }

  get isGraduated(): boolean {
    return this._mode === 'soa'
  }

  graduate(): void {
    this._assertLive()
    if (this._mode === 'js') {
      this._graduateToSoA()
    }
  }
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
  return new VecImpl(def, opts)
}
