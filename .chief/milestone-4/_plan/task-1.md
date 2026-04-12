# Task 1 -- Vec Core (Fixed Capacity)

## Objective

Create `src/vec/vec.ts` with the `vec()` factory function and a `Vec<F>` implementation that supports push/pop/get/len/capacity/clear/drop/buffer/column. This task ships a fixed-capacity vec (no growth, no swapRemove/remove, no iterator). It is the "slab but simpler" baseline: contiguous from index 0 to len-1, no bitmap, no free-list. Push advances a length pointer and writes fields. Pop decrements it.

The vec reuses milestone-3's SoA infrastructure entirely: `computeColumnLayout()`, `generateSoAHandleClass()`, `ColumnKey<F>`, `ColumnType<F, K>`. The only new code is the container logic.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_goal/goal.md`
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_contract/public-api.md`
8. Current source (read for SoA infrastructure reuse):
   - `/Users/thada/gits/thaitype/rigidjs/src/types.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/layout.ts` -- `computeColumnLayout()`, `ColumnDesc`, `ColumnLayout`, `HandleNode`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts` -- `generateSoAHandleClass()`, `ColumnRef`, `SoAHandleConstructor`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/struct.ts` -- `StructDef` shape
   - `/Users/thada/gits/thaitype/rigidjs/src/slab/slab.ts` -- reference for how slab builds TypedArray columns from `ColumnLayout` (reuse pattern, do not copy)
   - `/Users/thada/gits/thaitype/rigidjs/src/index.ts` -- current exports (do NOT modify in this task)

## Scope Guardrails

- **New files only:** `src/vec/vec.ts` and `tests/vec/vec-basic.test.ts` (or similar test file name).
- **Do NOT edit** `src/index.ts` (re-export happens in task-3), `src/slab/**`, `src/struct/**`, `benchmark/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, `package.json`, `tsconfig.json`.
- **Do NOT implement** growth (push throws "vec is full" when len === capacity in this task), swapRemove, remove, or `Symbol.iterator`. Those land in task-2 and task-3.
- **No new runtime dependencies.**
- **No `/tmp` scripts.**
- **TypeScript strict mode.** Zero `any` in exported signatures. Internal `any` tolerated only at the `new Function()` bridge site (same pattern as slab).
- **Allocation budget:** handle field get/set = 0 allocations. `push()` = 0 allocations (advance length pointer + rebase handle). `vec()` construction = 1 ArrayBuffer + TypedArray sub-views + handle + bookkeeping.

## Deliverables

### 1. `src/vec/vec.ts` -- vec factory and Vec implementation

Create the file. Export the `vec()` factory function with the signature from the contract:

```ts
export function vec<F extends StructFields>(
  def: StructDef<F>,
  initialCapacity?: number,
): Vec<F>
```

Internal implementation must:

1. Call `computeColumnLayout(def.fields)` to get the `ColumnLayout`.
2. Compute total buffer size: `layout.sizeofPerSlot * capacity` bytes.
3. Allocate a single `ArrayBuffer(totalBytes)`.
4. Build TypedArray sub-views for each column (same pattern as slab -- `new Float64Array(buffer, col.byteOffset * capacity_factor, capacity)` etc.). The exact byte offset computation must account for the SoA layout where each column occupies a contiguous range: `column.byteOffset * capacity` for the byte start within the buffer, or however slab computes it. Read slab.ts to understand the exact formula and replicate.
5. Call `generateSoAHandleClass(layout.handleTree, columnRefMap)` to get the handle constructor.
6. Construct one shared handle instance at slot 0.
7. Track `_len` (starts at 0), `_capacity`, `_dropped` flag.

**push():** Check not dropped. If `_len >= _capacity`, throw "vec is full" (growth lands in task-2). Set `_len++`, rebase handle to `_len - 1`, return handle.

**pop():** Check not dropped. If `_len === 0`, throw "vec is empty". Decrement `_len`.

**get(index):** Check not dropped. If `index >= _len` or `index < 0`, throw "index out of range". Rebase handle to index, return handle.

**len / capacity:** Read-only getters returning `_len` / `_capacity`.

**clear():** Check not dropped. Set `_len = 0`.

**drop():** Set `_dropped = true`. Null out buffer and column refs to help GC.

**buffer:** Check not dropped. Return the underlying `ArrayBuffer`.

**column(name):** Check not dropped. Look up column by name in the internal map. If not found, throw "unknown column: <name>". Return the TypedArray view.

### 2. `tests/vec/vec-basic.test.ts` -- core correctness tests

Create test file with at minimum these cases:

- Create a vec, verify `len === 0`, `capacity === initialCapacity`.
- Default capacity is 16 when no second argument given.
- `push()` returns handle, handle fields are writable and readable.
- Multiple push() calls increment len correctly.
- `get(i)` reads back correct field values for each pushed element.
- `pop()` decrements len.
- `pop()` on empty vec throws "vec is empty".
- `push()` at full capacity throws "vec is full" (temporary -- task-2 replaces with growth).
- Handle reuse: `push()` and `get(i)` return the SAME handle instance (reference equality).
- `handle.slot` returns the correct index after push/get.
- `clear()` resets len to 0.
- `drop()` then any operation throws "vec has been dropped".
- `buffer` returns an ArrayBuffer. `buffer.byteLength` equals expected total bytes.
- `column('pos.x')` returns a Float64Array for an f64 field.
- `column('pos.x').buffer === vec.buffer` (same-buffer guarantee).
- Column write-through: `column('x')[0] = 42` then `get(0).x === 42`.
- Handle write-through: `get(0).x = 99` then `column('x')[0] === 99`.
- `column('nonexistent')` throws "unknown column: nonexistent".
- Nested struct fields: `push()` then `h.pos.x = 1; h.pos.y = 2` works correctly.
- Nested column access: `column('pos.x')` works for nested structs.

## Acceptance Criteria

- [ ] `bun test` exits 0 with zero failing tests. Total test count increases.
- [ ] `bun run typecheck` exits 0.
- [ ] `src/vec/vec.ts` exists and exports `vec()` with the contract signature.
- [ ] All existing slab/struct tests pass unchanged. `git diff src/slab/ src/struct/ tests/slab/ tests/struct/` is empty.
- [ ] `src/index.ts` is unchanged (re-export in task-3).
- [ ] `benchmark/**` is unchanged.
- [ ] No new runtime dependencies. `package.json` byte-identical.
- [ ] No `/tmp` scripts.
- [ ] No `Proxy` introduced.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-4/_plan/_todo.md`** -- the chief-agent owns that checklist.

## Out of Scope

- Growth (ArrayBuffer reallocation on overflow) -- task-2.
- `swapRemove(index)` -- task-2.
- `remove(index)` -- task-2.
- `Symbol.iterator` / `for..of` -- task-3.
- Re-exporting from `src/index.ts` -- task-3.
- Examples -- task-3.
- Benchmarks -- task-5.
- Slab free-list optimization -- task-4.
- Editing any existing source files.

## Notes

- The vec buffer layout is identical to slab's SoA layout: columns are contiguous ranges within a single ArrayBuffer, sorted by element size descending for natural alignment. The only difference is that vec tracks `_len` instead of a bitmap. Read slab.ts carefully to replicate the buffer construction logic.
- The "vec is full" error on push is temporary. Task-2 replaces it with automatic growth. This keeps task-1 focused on the container logic without the complexity of buffer reallocation.
- Default initial capacity of 16 is a reasonable starting point -- small enough to not waste memory, large enough to avoid immediate growth for small use cases.
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes, at least one new test per new public symbol.
