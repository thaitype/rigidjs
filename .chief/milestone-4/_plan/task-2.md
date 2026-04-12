# Task 2 -- Growth + swapRemove + remove

## Objective

Extend the fixed-capacity vec from task-1 with three features: (1) automatic ArrayBuffer growth on push overflow, (2) `swapRemove(index)` for O(1) unordered removal, and (3) `remove(index)` for O(n) order-preserving removal. After this task, vec is a fully functional growable container with all mutation operations.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_goal/goal.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_contract/public-api.md` -- swapRemove/remove semantics, error behaviour, column-ref invalidation
7. Current source:
   - `/Users/thada/gits/thaitype/rigidjs/src/vec/vec.ts` -- task-1 output (the file to edit)
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/layout.ts` -- `computeColumnLayout()`, `ColumnDesc`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts` -- `generateSoAHandleClass()`

## Scope Guardrails

- **Edits to:** `src/vec/vec.ts` only, plus new/extended test files under `tests/vec/`.
- **Do NOT edit** `src/index.ts`, `src/slab/**`, `src/struct/**`, `benchmark/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, `package.json`, `tsconfig.json`.
- **Do NOT implement** `Symbol.iterator` -- that is task-3.
- **No new runtime dependencies.**
- **No `/tmp` scripts.**

## Deliverables

### 1. Growth on push overflow

Replace the "vec is full" throw from task-1 with automatic ArrayBuffer doubling.

When `push()` is called and `_len >= _capacity`:

1. Compute `newCapacity = _capacity * 2`.
2. Allocate a new `ArrayBuffer(layout.sizeofPerSlot * newCapacity)`.
3. Create new TypedArray sub-views for each column into the new buffer.
4. Copy data from old columns to new columns: `newCol.set(oldCol)` for each column. This copies all `_capacity` elements in one native call per column.
5. Update `_capacity = newCapacity`.
6. Update all internal column refs (the internal column map, the buffer reference).
7. Update the handle so its closure-captured column refs point to the new TypedArrays. Two strategies:
   - **A.** Re-create the handle via a new call to `generateSoAHandleClass()` constructor with new column refs. One allocation per growth event.
   - **B.** Store column refs in a mutable wrapper object that the closure captures by reference. On growth, update wrapper in-place. Zero allocation per growth.
   - Builder picks the simpler option and documents why in `.chief/milestone-4/_report/task-2/notes.md`.
8. Proceed with the push (increment len, rebase handle, return handle).

The old ArrayBuffer and old TypedArray views become unreferenced after growth and are GC-collectable.

### 2. `swapRemove(index)`

For each column in the struct's flattened column list:
```
column[index] = column[len - 1]
```
Then decrement `_len` by 1.

Edge case: if `index === _len - 1`, the copy is a self-assignment (harmless). Just decrement len.

Throw "index out of range" if `index >= _len` or `index < 0`. Throw "vec has been dropped" after drop.

### 3. `remove(index)`

For each column in the struct's flattened column list:
```
column.copyWithin(index, index + 1, _len)
```
Then decrement `_len` by 1.

`copyWithin` handles the overlapping source/destination correctly (it is specified to behave as if data is first copied to a temp buffer). This shifts all elements after `index` left by one.

Throw "index out of range" if `index >= _len` or `index < 0`. Throw "vec has been dropped" after drop.

### 4. Tests -- `tests/vec/vec-growth.test.ts` (or extend existing test file)

At minimum:

**Growth tests:**
- Push beyond initial capacity triggers growth. `capacity` doubles. `len` reflects all pushed elements.
- After growth, previously pushed values are preserved (read back via get).
- After growth, `buffer` is a new ArrayBuffer (different reference from before growth).
- After growth, `column('pos.x')` returns a new TypedArray (different reference from before growth).
- After growth, `column('pos.x').buffer === vec.buffer` (same-buffer guarantee with new buffer).
- Growth from capacity 1: push 2 elements into `vec(def, 1)` succeeds, capacity becomes 2.
- Multiple growth events: push 100 elements into `vec(def, 4)`, verify all values preserved.

**swapRemove tests:**
- `swapRemove(0)` on a vec with 3 elements: element at index 0 gets value from index 2, len becomes 2.
- `swapRemove(len-1)` is equivalent to pop: len decrements, no data movement.
- `swapRemove` on single-element vec: len becomes 0.
- `swapRemove` with out-of-range index throws "index out of range".
- `swapRemove` after drop throws "vec has been dropped".
- Values at remaining indices are correct after swapRemove.

**remove tests:**
- `remove(0)` on a vec with [A, B, C]: result is [B, C], len = 2. Order preserved.
- `remove(1)` on a vec with [A, B, C]: result is [A, C], len = 2. Order preserved.
- `remove(len-1)` on a vec with [A, B, C]: result is [A, B], len = 2.
- `remove` on single-element vec: len becomes 0.
- `remove` with out-of-range index throws "index out of range".
- `remove` after drop throws "vec has been dropped".

**Column-ref invalidation tests:**
- Get column ref before growth. Push to trigger growth. Old column ref's buffer is NOT the vec's current buffer.
- New column ref after growth points at new buffer.

### 5. Task-2 report

Write `.chief/milestone-4/_report/task-2/notes.md` with:

- Which growth strategy was chosen (A or B) and why.
- How column refs are updated after growth.
- swapRemove and remove implementation details.
- Test count added.

## Acceptance Criteria

- [ ] `bun test` exits 0 with zero failing tests. Total test count increases.
- [ ] `bun run typecheck` exits 0.
- [ ] `push()` no longer throws "vec is full" -- it grows automatically.
- [ ] `swapRemove(index)` works per contract semantics.
- [ ] `remove(index)` works per contract semantics with order preservation.
- [ ] Growth preserves all previously pushed data.
- [ ] Column-ref invalidation after growth is tested.
- [ ] All existing slab/struct tests pass unchanged.
- [ ] `src/slab/**`, `src/struct/**`, `src/index.ts` unchanged.
- [ ] `benchmark/**` unchanged.
- [ ] No new runtime dependencies.
- [ ] No `/tmp` scripts.
- [ ] Task-2 notes exist at `.chief/milestone-4/_report/task-2/notes.md`.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-4/_plan/_todo.md`**.

## Out of Scope

- `Symbol.iterator` / `for..of` -- task-3.
- Re-exporting from `src/index.ts` -- task-3.
- Benchmarks -- task-5.
- Slab free-list optimization -- task-4.
- Examples -- task-3.

## Notes

- Growth is amortized O(1): each element is copied at most O(log n) times across all growth events, and each individual push is O(1) amortized. The 2x doubling strategy matches Rust's Vec and JS Array internals.
- `TypedArray.set(source)` is the preferred way to bulk-copy column data. It is a single native call that copies the entire source TypedArray into the target. Much faster than element-wise copy.
- `TypedArray.copyWithin(target, start, end)` is specified to handle overlapping ranges correctly. It is the right primitive for the left-shift in `remove()`.
- swapRemove is the primary "remove from middle" API for hot-path code. remove is the slow path for when order matters. Document this distinction in JSDoc.
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes.
