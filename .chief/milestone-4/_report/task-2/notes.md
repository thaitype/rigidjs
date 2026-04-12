# Task-2 Implementation Notes

## Growth Strategy: A (Re-create handle on growth)

**Chosen:** Strategy A — re-create the handle via a new call to `generateSoAHandleClass()` + new constructor call on each growth event.

**Why Strategy A over Strategy B:**

The existing `generateSoAHandleClass()` in `src/struct/handle-codegen.ts` bakes TypedArray instances directly into the generated class closure at `new Function()` construction time. Each column TypedArray is passed as a named parameter and stored as `this._c_<fieldname>` in the constructor body. There is no indirection layer.

Strategy B (mutable wrapper) would require modifying `handle-codegen.ts` to capture a wrapper object and read `wrapper.array` in the getter/setter instead of the TypedArray directly — e.g. changing `return this._c_pos_x[this._slot]` to `return this._c_pos_x.current[this._slot]`. This would add one extra property dereference per field access and require a codegen change outside the task scope.

Strategy A requires no changes to the codegen. On growth, we simply call `generateSoAHandleClass()` with the new `columnRefs` map and construct a new handle instance. This allocates one `SoAHandleConstructor` class and one handle object per growth event — a negligible cost relative to the buffer reallocation itself.

## How Column Refs Are Updated After Growth

1. `grow()` allocates `newBuf = new ArrayBuffer(layout.sizeofPerSlot * newCapacity)`.
2. `buildColumns(newBuf, newCapacity)` rebuilds `_columnMap` and `columnRefs` with new TypedArray sub-views over `newBuf`.
3. For each column in `layout.columns`, `newArr.set(oldArr)` bulk-copies all `_capacity` elements from the old array to the new array in one native call.
4. `_buf` and `_capacity` are updated.
5. `HandleClass = generateSoAHandleClass(layout.handleTree, columnRefs)` generates a new handle class whose closure captures the new TypedArrays.
6. `_handle = new HandleClass(0)` creates the new shared handle instance.

The old `ArrayBuffer`, old TypedArrays, old handle class, and old handle instance become unreferenced and are GC-collectable. Previously returned `column()` references point at the old buffer (stale — documented in JSDoc).

## swapRemove Implementation

For each column in `layout.columns`:
```
arr[index] = arr[len - 1]
```
Then `_len--`. One indexed write per column — O(1) total. When `index === len - 1`, this is a harmless self-assignment.

Throws "index out of range" when `index < 0 || index >= _len`. Throws "vec has been dropped" after drop.

## remove Implementation

For each column in `layout.columns`:
```
arr.copyWithin(index, index + 1, _len)
```
Then `_len--`. `TypedArray.copyWithin` is specified to handle overlapping source/destination correctly (copies as if via a temporary buffer). One native bulk-copy call per column — O(n) where n = `len - index - 1`.

Throws "index out of range" when `index < 0 || index >= _len`. Throws "vec has been dropped" after drop.

## Test Count Added

- `tests/vec/vec-basic.test.ts`: 1 test updated (removed "vec is full" expectation, replaced with growth verification).
- `tests/vec/vec-growth.test.ts`: 29 new tests added across 4 describe blocks:
  - `vec growth` — 8 tests
  - `vec column-ref invalidation after growth` — 2 tests
  - `vec swapRemove` — 8 tests
  - `vec remove` — 9 tests
