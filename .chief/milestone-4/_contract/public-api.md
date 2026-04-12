# Milestone 4 Public API Contract

Strict extension of `.chief/milestone-3/_contract/public-api.md`. Every symbol from milestone-1, milestone-2, and milestone-3 remains exported with **identical signatures and identical semantics**. Milestone-4 adds the `vec()` factory function, the `Vec<F>` interface, and re-exports them from `src/index.ts`. Nothing is renamed, removed, or reshaped.

## Exported Symbols (cumulative)

```ts
// from 'rigidjs'
export { struct, slab, vec }
export type {
  StructDef,
  StructFields,
  NumericType,
  Slab,
  Handle,
  ColumnKey,
  ColumnType,
  // --- milestone-4 additions ---
  Vec,
}
```

## Unchanged from Milestone-3

Every symbol documented in `.chief/milestone-3/_contract/public-api.md` keeps its exact signature, JSDoc semantics, and error behaviour:

- `struct(fields)` -- unchanged.
- `slab(def, capacity)` -- unchanged constructor signature.
- `Slab<F>` -- all members unchanged. `insert()`, `remove(slot)`, `get(slot)`, `has(slot)`, `len`, `capacity`, `clear()`, `drop()`, `buffer`, `column(name)` -- all unchanged.
- `Handle<F>` -- unchanged observable shape. `handle.slot` getter unchanged.
- `ColumnKey<F>`, `ColumnType<F, K>` -- unchanged.

Internal implementation details of slab (e.g. free-list data structure) may change. The slab free-list optimization from JS Array to Uint32Array is an internal change not visible in the public contract.

## New in Milestone-4

### `vec(def, initialCapacity?)` -- factory function

```ts
/**
 * Create a growable, ordered, densely-packed container for structs.
 *
 * Vec stores elements contiguously from index 0 to len-1 with no holes.
 * When capacity is exceeded on push(), the backing ArrayBuffer is
 * reallocated at 2x capacity and all columns are copied via
 * TypedArray.set().
 *
 * @param def - The struct definition (from struct()).
 * @param initialCapacity - Starting capacity. Defaults to 16.
 * @returns A new Vec instance.
 */
export function vec<F extends StructFields>(
  def: StructDef<F>,
  initialCapacity?: number,
): Vec<F>
```

### `Vec<F>` -- interface

```ts
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
   * @throws "index out of range" if index >= len.
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
   * @param index - Must be in [0, len).
   * @throws "index out of range" if index >= len.
   * @throws "vec has been dropped" after drop().
   */
  swapRemove(index: number): void

  /**
   * O(n) removal: shift all elements after index left by one position
   * across all columns using TypedArray.copyWithin(), then decrement len.
   * Order is preserved.
   *
   * @param index - Must be in [0, len).
   * @throws "index out of range" if index >= len.
   * @throws "vec has been dropped" after drop().
   */
  remove(index: number): void

  /** Current element count (0 <= len <= capacity). */
  readonly len: number

  /** Current buffer capacity in element count. */
  readonly capacity: number

  /**
   * Reset len to 0. Keeps the buffer and capacity unchanged.
   * Existing data is not zeroed -- it becomes inaccessible via the API
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
   * This is the same pattern as C++ vector iterator invalidation.
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
   */
  [Symbol.iterator](): Iterator<Handle<F>>
}
```

### Handle shape for vec

Vec handles have the same observable shape as slab handles:

```ts
interface HandleBase {
  readonly slot: number  // current index the handle points to
}
```

For vec, `slot` returns the current element index (0-based). The handle is shared -- push(), get(), and the for..of iterator all return/yield the SAME handle instance rebased to the target index.

## Semantics of `vec.column()`

- **Allocation-free per call.** The TypedArray view is built at construction (and rebuilt on growth). `column(name)` returns the current pre-built reference.
- **Same-buffer guarantee.** `vec.column('pos.x').buffer === vec.buffer` holds at any point.
- **Length.** The returned TypedArray's `length` equals `vec.capacity`. Only indices `[0, vec.len)` contain valid data.
- **Index identity.** For any valid index `i` and column `K`, `vec.column(K)[i]` and `vec.get(i).<K>` read/write the same memory cell.
- **Mutation safety.** Same as slab -- writes through column TypedArray are immediately visible via handle accessors and vice versa.
- **Invalidation on growth.** When vec grows (push triggers reallocation), ALL previously returned column() references and the buffer reference become stale. They point at the old (now unreferenced) ArrayBuffer. Users must re-resolve column() and buffer after any push() that might trigger growth. Document this prominently in JSDoc.
- **Drop behaviour.** After `vec.drop()`, `column(name)` throws "vec has been dropped".

## `swapRemove` semantics

For each column in the struct, `swapRemove(index)` copies the value at `len-1` to `index`:

```
column[index] = column[len - 1]
```

Then decrements `len` by 1. This is one TypedArray indexed write per column -- O(1) total regardless of vec size.

After `swapRemove(i)`, the element that was previously at `len-1` now lives at index `i`. The element that was at `i` is gone. Indices `[0, new_len)` are all valid.

If `index === len - 1`, `swapRemove` is equivalent to `pop()` -- the copy is a no-op (same source and destination).

## `remove` semantics

For each column in the struct, `remove(index)` shifts elements left:

```
column.copyWithin(index, index + 1, len)
```

Then decrements `len` by 1. `copyWithin` is a native bulk memory move -- O(n) where n = `len - index - 1` elements moved.

After `remove(i)`, element order is preserved. The element that was at `i` is gone. All elements after `i` shifted left by one.

## `for..of` iteration semantics

```ts
const v = vec(Point, 1000)
// ... push elements ...

for (const h of v) {
  // h is the shared handle, rebased to the current index
  console.log(h.slot, h.x, h.y)
  // DO NOT store h -- it will be rebased on the next iteration
  // Capture primitives: const x = h.x
}
```

- Iterates indices 0 to len-1 in order.
- Yields the shared handle at each step (zero allocation per next() call).
- One iterator object allocated per for..of invocation.
- Modifying the vec during iteration (push, pop, swapRemove, remove) is undefined behaviour. Do not do it.

## Error Behaviour

| Operation | Condition | Error message |
|---|---|---|
| `push()` | After `drop()` | "vec has been dropped" |
| `pop()` | `len === 0` | "vec is empty" |
| `pop()` | After `drop()` | "vec has been dropped" |
| `get(i)` | `i >= len` | "index out of range" |
| `get(i)` | After `drop()` | "vec has been dropped" |
| `swapRemove(i)` | `i >= len` | "index out of range" |
| `swapRemove(i)` | After `drop()` | "vec has been dropped" |
| `remove(i)` | `i >= len` | "index out of range" |
| `remove(i)` | After `drop()` | "vec has been dropped" |
| `clear()` | After `drop()` | "vec has been dropped" |
| `column(name)` | After `drop()` | "vec has been dropped" |
| `column(name)` | Invalid name | "unknown column: <name>" |
| `buffer` | After `drop()` | "vec has been dropped" |

Note: `push()` never throws for capacity -- it grows automatically. It only throws after `drop()`.

## Layout Rules (observable)

Vec uses the same SoA column layout as slab:
- Same `computeColumnLayout()` from milestone-3.
- Same natural-alignment sort for column ordering.
- Same `StructDef.sizeof` value.
- Same nested struct flattening into dotted-key columns.

## Stability

All symbols listed in this file are append-only within milestone-4. Renaming or removing any symbol from milestone-3 or earlier, or changing the `vec()` / `Vec<F>` signatures, requires a chief-agent-driven contract amendment.

## Not Yet Exported (Still)

`bump`, `.iter()`, `for..of` on slab, string types, `.insert({...})` object form -- deferred to future milestones.
