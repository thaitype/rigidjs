# Task 3 — Wire Slab to Single-Buffer SoA + Add `slab.column()`

## Objective

Cut the slab over from the old AoS + DataView path to the new SoA + TypedArray codegen path built in task-2. After this task, `src/slab/slab.ts` allocates exactly one `ArrayBuffer`, builds a pre-sliced TypedArray sub-view per flattened column, passes those refs to `generateSoAHandleClass(...)`, and constructs the single reusable handle via the new SoA constructor. Add the public `slab.column(name)` method backed by a pre-built lookup map. Delete the old DataView codegen path (`generateHandleClass`, old `computeLayout`) once nothing uses it. Ensure every existing test still passes — internal tests that poked the old `_v` / `_o` / `DataView` shape must be updated to the new internal shape, but **no behavioural test changes**. Finally run the full benchmark suite and archive raw results to `.chief/milestone-3/_report/task-3/` for task-4 to consume.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_goal/goal.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_contract/public-api.md` — authoritative for the `column()` signature
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_plan/task-2.md` — the layout + codegen infrastructure this task consumes
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_report/task-2/notes.md` — where task-2 documented its design decisions
9. Current source (now post-task-2 state):
   - `/Users/thada/gits/thaitype/rigidjs/src/types.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/struct.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/layout.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/slab/slab.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/slab/bitmap.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/internal/single-slot.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/index.ts`
10. Current tests under `tests/struct/**` and `tests/slab/**`
11. Current benchmark harness under `benchmark/**` (read for context — no edits in this task except possibly to accommodate the new slab shape if a harness method breaks, see §Scope Guardrails)

## Scope Guardrails

- **Surface area.** Edits land in `src/slab/slab.ts`, `src/struct/handle-codegen.ts` (to delete old path), `src/struct/layout.ts` (to delete old path), `src/struct/struct.ts` (if it still references the old codegen), `src/index.ts` (re-export `ColumnKey` / `ColumnType` if task-2 did not already), and `src/internal/single-slot.ts` (if it uses the old DataView path it must cut over or be adjusted). Test files under `tests/struct/**` and `tests/slab/**` may be edited **only** to update internal-shape probes that actively break after the cutover — behavioural assertions must not change.
- **Benchmark code may be touched ONLY to keep it compiling against the new public API.** In practice this means: if any benchmark scenario file imports from `'../../src/index.js'` and uses the slab through the public API (which is the rule), nothing needs to change. If any scenario file broke a rule and deep-imports into `src/slab/**`, that is a pre-existing bug and must be fixed to go through public API — escalate to chief-agent if the fix is non-trivial.
- **Preserve `slab.buffer`.** Still returns a single `ArrayBuffer`. The buffer identity is stable across all `column()` calls: for every valid column name, `slab.column(name).buffer === slab.buffer` must hold.
- **Preserve every milestone-2 contract symbol and semantic.** `slab.insert()` / `remove(slot)` / `get(slot)` / `has(slot)` / `len` / `capacity` / `clear()` / `drop()` — signatures identical, throws identical, handle reuse identical. The only additive change is `column(name)`.
- **Zero `src/**` allocations on hot paths.** Handle field get/set: 0 allocations. `insert()` / `remove(slot)` / `get(slot)` / `has(slot)`: 0 allocations. `column(name)`: 0 allocations (returns a pre-built reference from a lookup map).
- **No new runtime dependencies.**
- **No `/tmp` scripts.**
- **TypeScript strict mode applies.** Zero `any` in exported signatures. Internal `any` limited to the generated-class bridge, isolated with a comment.
- **Task-1's fixed JIT counter work stays intact.** No edits to `benchmark/harness.ts` or `benchmark/probe-jsc.ts` unless the slab's new shape forces a fix (unlikely — benchmarks use only public API).

## Deliverables

### 1. `src/slab/slab.ts` — full SoA rewrite

Replace the slab body so it follows this shape. Function signature, return interface, and throw messages stay identical to milestone-2.

#### 1a. Construction phase

Inside `slab(def, capacity)`:

1. Validate `capacity` as before (positive integer).
2. Compute column layout via `computeColumnLayout(def.fields)`. Call this result `layout`.
3. Allocate exactly ONE `ArrayBuffer` of size `layout.sizeofPerSlot * capacity`. Name it `_buf`.
4. Build one TypedArray sub-view per column:
   ```ts
   // For each column in layout.columns:
   //   byteOffset = column.byteOffset * capacity          // starts at column.byteOffset * capacity
   //   length     = capacity
   //   arr        = new <TypedArraySubclass>(buf, byteOffset, length)
   ```
   Wait — the byte layout is: the first column occupies `capacity * elementSize` contiguous bytes at the start of the buffer, the next column occupies `capacity * elementSize` bytes after that, and so on. The `byteOffset` inside the buffer for column `i` is `sum(column[j].elementSize * capacity for j < i)`. Because `computeColumnLayout` sorts columns by element size descending, the running byte offset at the start of column `i` is always a multiple of column `i`'s element size (proof: all larger or equal element sizes came before, each contributing an integer multiple of the smaller size).

   Builder must verify the above invariant holds at runtime for every column with an assertion before constructing the sub-view — if `byteOffset % elementSize !== 0` the TypedArray constructor throws with a confusing message; catch the precondition ourselves with a clear error. Cite task-2's alignment proof in the assertion's error message.
5. Store the column sub-views in a `Map<string, TypedArray>` keyed by the flattened dotted-key name. Call it `_columnMap`.
6. Build the reusable handle via `generateSoAHandleClass(layout.handleTree, columnRefsFromMap)`. The codegen returns a constructor; instantiate it with slot 0: `const _handle = new HandleClass(0)`.
7. Build the bitmap and free-list exactly as milestone-2 (unchanged).

#### 1b. `insert()` / `remove()` / `get()` / `has()`

Semantics unchanged from milestone-2. The only internal change is that `insert()` and `get()` call `_handle._rebase(slot)` instead of `_handle._rebase(_view, slot * def.sizeof, slot)` — the SoA `_rebase` signature is `(slot: number) => this`, not `(view, offset, slot)`.

Throw messages must be byte-identical to milestone-2.

#### 1c. `column(name)` — new public method

```ts
column<K extends ColumnKey<F>>(name: K): ColumnType<F, K> {
  assertLive()
  const arr = _columnMap.get(name)
  if (arr === undefined) {
    throw new Error(`unknown column: ${name}`)
  }
  // The TypedArray subclass resolution is proven type-safe by ColumnType<F, K>,
  // but at runtime we return a boxed TypedArray reference — the subclass is
  // whatever was constructed during slab setup. Cast through unknown once.
  return arr as unknown as ColumnType<F, K>
}
```

Notes:
- `_columnMap.get(name)` is O(1) average case. The runtime cost is a single Map lookup — acceptable because `column()` is called once by user code at the top of a hot loop, not inside the loop.
- The only `any` / `unknown` cast in this method is the final return. Explain with a one-line comment that the runtime TypedArray subclass is determined by the column's numeric token at slab construction and is guaranteed to match `ColumnType<F, K>` by the layout invariants in task-2.
- Throws `"slab has been dropped"` after drop via the existing `assertLive()`.
- Throws `"unknown column: <name>"` if the name is not a valid column — this catches users who forget to propagate the struct type through a generic and pass an arbitrary string.

#### 1d. `drop()` and `buffer`

- `drop()` — unchanged semantics. Flip `_dropped` flag, null out the buffer reference, subsequent calls throw.
- `buffer` getter — unchanged. Still returns `_buf`, the single `ArrayBuffer`.
- After drop, `column(name)` throws via `assertLive()`. The `_columnMap` entries continue to point at detached TypedArrays until GC reclaims them — users should not retain references past drop. This matches the existing rule for `slab.buffer`.

### 2. Delete the old AoS + DataView codegen path

Once `slab.ts` is fully on the SoA path and all tests pass:

- Remove `generateHandleClass(...)` from `src/struct/handle-codegen.ts`. Remove the `HandleConstructor` interface if it is no longer referenced.
- Remove `computeLayout(...)` and `LayoutResult` from `src/struct/layout.ts` if they are no longer referenced, OR rename and repurpose them if task-2 left the old path wired to `StructDef._Handle` as a bridge. Verify by grep that no production code path calls the old functions before deleting.
- Check `src/struct/struct.ts`: if it still assigns `_Handle` via the old codegen, rewire it to the new SoA factory. The `_Handle` field on `StructDef<F>` may be removed entirely if the slab is now the only consumer and it calls the SoA factory directly — decide based on whether `createSingleSlot` in `src/internal/single-slot.ts` still needs a struct-level handle.
- Check `src/internal/single-slot.ts`: this helper was used by milestone-1 tests to exercise handle accessors without a slab. If it uses the old DataView codegen path, rewrite it to use `generateSoAHandleClass` with a single-slot column layout (capacity = 1). This keeps milestone-1 struct tests green without allocating a full slab for every fixture. If `single-slot.ts` is no longer called by any test file after the cutover, delete it entirely — verify by grep.

The cutover must leave **zero dead code** in the struct layer. Grep for `DataView` across `src/**` after the cutover — it should appear only in JSDoc historical mentions, if at all. If `DataView` still appears in runtime code under `src/**`, the cutover is incomplete.

### 3. `src/index.ts` — re-export `ColumnKey` and `ColumnType`

If task-2 did not already export these, add:

```ts
export type { ColumnKey, ColumnType } from './types.js'
```

The runtime exports (`struct`, `slab`) and existing type exports (`StructDef`, `StructFields`, `NumericType`, `Slab`, `Handle`) stay exactly as they are.

### 4. Test updates (internal-shape probes only)

Grep under `tests/**` for internal-shape probes that break after the cutover. Candidates:

- Any `expect((h as any)._v)...` or `expect((h as any)._o)...` — the SoA handle no longer has `_v` / `_o`. These tests either move to the new shape (`expect((h as any)._slot)...`) or are deleted if they tested purely implementation detail that no longer has meaning.
- Any test that instantiates the old handle class directly by importing from `src/struct/handle-codegen.ts`. These must either use `createSingleSlot` or call the new SoA factory.
- Any test that calls `computeLayout(...)` by name. If task-2 kept the function, leave the test. If task-3 deletes it, delete the test (the behaviour it guarded is now covered by `computeColumnLayout` tests).

**Behavioural tests must not change.** If a test asserts `slab.get(0).pos.x === 1.5`, that assertion stays byte-identical. The cutover is an internal refactor from the user's perspective.

Add new behavioural tests for `slab.column()`:

- `tests/slab/column.test.ts` — a new file covering:
  1. `slab.column('pos.x')` returns a `Float64Array` of length `capacity`.
  2. Mutations via `slab.get(i).pos.x = 42` are observable via `slab.column('pos.x')[i] === 42`.
  3. Mutations via `slab.column('pos.x')[i] = 99` are observable via `slab.get(i).pos.x === 99`.
  4. `slab.column('pos.x').buffer === slab.buffer` (same underlying ArrayBuffer).
  5. `slab.column('id')` returns a `Uint32Array` (verify with `instanceof`).
  6. `slab.column('unknown-name' as any)` throws `"unknown column: unknown-name"` (use a cast because a valid `ColumnKey<F>` can't be "unknown-name" at type level — the runtime guard is still required for unsafe callers).
  7. After `slab.drop()`, `slab.column('pos.x')` throws `"slab has been dropped"`.
  8. Calling `slab.column('pos.x')` 1000 times in a loop does not allocate (informal check: no explicit assertion needed, just prove it's the same returned reference — `ref1 === ref2`).

Verify coverage per `.chief/_rules/_verification/verification.md`: every public API symbol added must have at least one correctness test.

### 5. Run the full benchmark suite

After tests pass and `bun run typecheck` is clean, run:

```
bun run bench
```

This runs the harness with the task-1-fixed JIT counters against the new SoA slab. Expected:

- B1, B2, B3, B7 one-shot results flow to `.chief/milestone-2/_report/task-7/` (task-7 flow is unchanged — it re-runs but that's fine, the overwrite is of milestone-2 task-7 report files; actually **do NOT overwrite task-7 report files** — see Scope Guardrails below).

**Important correction on bench output paths:** task-10 / task-1 set up `benchmark/run.ts` to write to `.chief/milestone-2/_report/task-7/`, `task-9/`, and `task-10/`. Those are milestone-2 directories. For task-3, we do NOT want to overwrite those files — task-1 already put corrected data there and milestone-3 is meant to be additive to milestone-2's evidence base.

The fix: for task-3, copy the raw results to `.chief/milestone-3/_report/task-3/{results.json, raw-stdout.txt}` **after** the bench run completes, then **revert** the three milestone-2 files overwritten during the run (via `git checkout`). This is the cleanest way to produce a milestone-3 raw dataset without mutating milestone-2's history.

Alternative (preferred if simpler): temporarily patch `benchmark/run.ts` to also write to `.chief/milestone-3/_report/task-3/results.json`, run bench, then revert the `benchmark/run.ts` patch once results are captured. Task-4 does the final structured report from task-3's raw data plus its own re-run. Builder picks whichever approach produces a clean git diff.

The strict constraint: at the end of task-3, `git diff .chief/milestone-2/` must be empty. Every task-10 file remains byte-identical to its task-1 state. Task-7 and task-9 remain byte-identical to their pre-milestone-3 state.

Archive the raw bench output to `.chief/milestone-3/_report/task-3/`:

- `results.json` — the raw `BenchResult[]` + `SustainedResult[]` (the same shape `benchmark/run.ts` produces).
- `raw-stdout.txt` — captured stdout from the bench run, including the formatted tables.
- `notes.md` — one-paragraph summary: did tests all pass, did `dfgΔ` show monomorphic behaviour (small delta on hot scenarios like B3), what is the immediate gut-reaction comparison vs task-10's numbers. No full report yet — that is task-4.

### 6. Task-3 notes

The `notes.md` in §5 serves dual purpose: it documents the cutover AND captures the gut-reaction bench read. Include:

- Which old functions were deleted.
- Which internal tests were updated vs deleted.
- Whether `single-slot.ts` was kept (rewired) or deleted.
- A one-liner per scenario: "B3 iter+mutate: JS <X> ops/s, RigidJS <Y> ops/s, ratio <Y/X>". Six lines max.
- A one-liner on `dfgΔ` for B3 specifically: is it 0 / low (monomorphic — success) or >5 (thrashing — something is wrong with the codegen)?
- Any surprises that block task-4's narrative.

## Probe-Verify Step

Before running the full benchmark, run these sanity probes:

1. **Buffer identity probe.** Write a tiny test (or inline `bun repl` check via a committed `benchmark/probe-column-buffer.ts`? — NO, probes go in benchmark/; if this check is a one-off use the new column test file, don't add a probe file unless it provides lasting value):
   ```ts
   const P = struct({ x: 'f64', y: 'f64' })
   const s = slab(P, 4)
   const xs = s.column('x')
   console.log(xs.buffer === s.buffer)       // expected: true
   console.log(xs.length === 4)              // expected: true
   console.log(xs instanceof Float64Array)   // expected: true
   s.insert().x = 42
   console.log(xs[0] === 42)                 // expected: true
   xs[1] = 99
   console.log(s.get(1).x === 99)            // expected: true
   ```
   If any of these is false, the wiring is wrong. These assertions should also live in `tests/slab/column.test.ts` so the check is permanent.

2. **Monomorphic JIT probe.** After the full bench run, open `.chief/milestone-3/_report/task-3/results.json` and find the B3 iter+mutate RigidJS scenario. Verify `dfgCompilesDelta` is a small integer (0 or 1 is ideal; ≤3 is acceptable). A value of 10+ on a hot iterate+mutate loop indicates the codegen is not monomorphic and the task is not complete.

3. **`slab.buffer` identity probe.** Verify there is still exactly one `ArrayBuffer` per slab: `const s = slab(P, 100); const b1 = s.buffer; const b2 = s.buffer; console.log(b1 === b2)`. Should be `true`. Also verify `s.column('x').buffer === b1`. Both assertions go in `tests/slab/column.test.ts`.

## Acceptance Criteria

- [ ] `bun test` exits 0. Total test count has increased (new column tests added).
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run examples/particles.ts` runs and produces identical deterministic output to milestone-2 (compare stdout byte-for-byte — tail the milestone-2 report if needed to get the expected output).
- [ ] `slab.buffer` returns a single `ArrayBuffer` for every slab. Grep confirms `new ArrayBuffer(` appears exactly once in `src/slab/slab.ts`.
- [ ] `slab.column(name).buffer === slab.buffer` for every valid column name (asserted in the new test).
- [ ] `slab.column(name)` returns the correct `TypedArray` subclass per the column's numeric token (asserted in the new test).
- [ ] `slab.column(name)` throws `"unknown column: <name>"` for invalid names and `"slab has been dropped"` after drop.
- [ ] No `Proxy` anywhere. Grep confirms.
- [ ] `DataView` does not appear in any runtime code under `src/**`. Grep confirms (JSDoc historical mentions are permitted but should be flagged for a future cleanup).
- [ ] `generateHandleClass` (old) is deleted. Grep confirms.
- [ ] `computeLayout` (old) is deleted or absorbed into `computeColumnLayout`. Grep confirms.
- [ ] Every milestone-2 contract symbol is still exported from `src/index.ts` with identical signatures. Cross-check against `.chief/milestone-2/_contract/public-api.md`.
- [ ] `src/index.ts` re-exports `ColumnKey` and `ColumnType` as type-only exports.
- [ ] `git diff .chief/milestone-2/` is empty. All milestone-2 report files are byte-identical to their state at end of task-1.
- [ ] `package.json` is byte-identical.
- [ ] Zero `/tmp` scripts created.
- [ ] `.chief/milestone-3/_report/task-3/results.json` exists with raw bench output.
- [ ] `.chief/milestone-3/_report/task-3/notes.md` exists with the gut-reaction summary.
- [ ] At least one scenario in `results.json` has `dfgCompilesDelta !== null` (the task-1 fix is still working). Most scenarios should have a small integer delta.
- [ ] B3 iter+mutate RigidJS scenario shows `dfgCompilesDelta <= 3` — evidence that the SoA codegen is monomorphic.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-3/_plan/_todo.md`** — the chief-agent owns that checklist.

## Out of Scope

- Writing the structured milestone-3 benchmark report. That is task-4.
- Adding the B3-column scenario. Task-4.
- Revising `.chief/_rules/_standard/memory-and-perf.md` to reflect the DataView → TypedArray shift. Future cleanup milestone.
- Revising the global `.chief/_rules/_contract/public-api.md` DataView language. Future cleanup milestone.
- Tuning the natural-alignment sort for exotic struct shapes — the basic sort is enough.
- Any milestone-2 report edits beyond the ones task-1 already made.
- String field types, `vec`, `bump`, `.iter`.

## Notes

- The alignment invariant (task-2 §2 proof) is what guarantees `new Float64Array(buf, byteOffset, capacity)` never throws. Re-derive it in the slab's assertion block so a future reader does not have to open task-2 notes to understand the invariant.
- `_columnMap` is a `Map<string, TypedArray>` instead of a plain object literal because the flattened dotted-key names contain `.` characters, and using an object with dotted keys is legal but slower for the TypedArray union type erasure path. A Map is marginally faster for string lookup and is more honest about the key semantics. Document the choice inline.
- `column()` is not on a hot path inside tight inner loops in user code — users call it ONCE at the top of their loop and then iterate the returned TypedArray directly. So the Map lookup cost is paid once per hot section, not per element. This is the key design choice that makes the column API worth it.
- If `src/internal/single-slot.ts` is kept alive through task-3 (because milestone-1 tests still use it), rewrite it to instantiate a 1-capacity slab internally. That single-slot shim has no need to understand layout — it just wraps a slab. Grep first to see if anything still calls it.
- When deleting old code, do it in one commit atomically. Do not leave a half-deleted state where some functions are gone but their callers remain — the typecheck will fail and the intermediate state is hard to reason about.
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes, every public API symbol has a test. The new `column()` method gets its own test file.
