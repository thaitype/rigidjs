# Task 2 — Layout + Codegen SoA Rewrite (Internal, Not Yet Wired)

## Objective

Rewrite the two internal pieces that determine how handle field access compiles to machine code: `src/struct/layout.ts` (byte offset computation) and `src/struct/handle-codegen.ts` (the `new Function()` handle class generator). Replace the AoS + DataView strategy with Structure-of-Arrays + monomorphic TypedArray indexed access. Add the public type helpers `ColumnKey<F>` and `ColumnType<F, K>` to `src/types.ts`. **Do not flip `src/slab/slab.ts` yet** — this task adds the new infrastructure alongside the old so existing tests stay green. Task-3 cuts over.

This task is infrastructure only. No user-visible API changes land here. Every existing test must continue to pass because the slab still uses the old path.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_goal/goal.md`
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_contract/public-api.md`
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/rigidjs-improvement-report.md` — §3.1 SoA, §3.4 monomorphic codegen
9. Current source:
   - `/Users/thada/gits/thaitype/rigidjs/src/types.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/struct.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/layout.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/slab/slab.ts` (not edited — just read for context on what consumes `_Handle`)
   - `/Users/thada/gits/thaitype/rigidjs/src/internal/single-slot.ts`
   - `/Users/thada/gits/thaitype/rigidjs/src/index.ts`
10. Current tests:
    - `/Users/thada/gits/thaitype/rigidjs/tests/struct/**`
    - `/Users/thada/gits/thaitype/rigidjs/tests/slab/**`

## Scope Guardrails

- **Internal surface area.** Edits land in `src/types.ts`, `src/struct/layout.ts`, `src/struct/handle-codegen.ts`, and optionally `src/struct/struct.ts` (only to wire the new layout output into `StructDef._Handle` if the existing constructor requires updating). Test files may be edited **only** if an internal test poked the old `_v` / `_o` / `_offsets` shape directly — behavioural tests must not change.
- **Do NOT edit `src/slab/slab.ts` in this task.** Slab continues to use the old AoS+DataView path. Task-3 cuts over.
- **Do NOT edit `benchmark/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, `.chief/milestone-2/**`, the design spec, `tsconfig.json`, `package.json`.** If the rewrite appears to require any of these, stop and escalate.
- **No new dependencies.**
- **No `/tmp` scripts.**
- **TypeScript strict mode applies.** Zero `any` in exported signatures. Internal `any` is permitted only at the generated-class bridge site (where `new Function()` returns an opaque constructor) and must be isolated with a comment, same pattern as the existing codegen file.
- **Preserve the public contract.** `struct()`, `StructDef.sizeof`, `StructDef.fields`, `Handle<F>` observable shape, nested dotted access (`h.pos.x`), `handle.slot` — all unchanged from the user's point of view.
- **Allocation budget unchanged.** Handle field get/set: 0 allocations. Codegen happens once at `struct()` call time.

## Design: what "single-buffer SoA" means at the codegen layer

The key insight: layout no longer produces a single `sizeof` + per-field byte offset. It produces **per-column descriptors** that carry:

1. A flattened dotted-key column name (`'pos.x'`, `'life'`, `'id'`, etc.).
2. The numeric token for that column (`'f64'`, `'u32'`, etc.) — determines the TypedArray subclass.
3. An **element offset** (not byte offset): the index at which this column's sub-view starts inside the single underlying buffer, expressed in **elements of the TypedArray subclass**, not bytes. E.g. if `pos.x` (f64) sits right after 10 bytes of something else, the code that eventually builds `new Float64Array(buf, byteOffset, length)` needs a `byteOffset` that is a multiple of 8 — hence the alignment sort.
4. The column's byte start and byte length (for slab construction later).

The handle codegen, in turn, gets one TypedArray ref per column, already sliced and aligned, and emits:

```ts
get posX() { return this._col_pos_x[this._slot] }
set posX(v) { this._col_pos_x[this._slot] = v }
```

Nested struct fields are flattened into parent-level columns (`pos.x`, `pos.y`, `pos.z`), but the handle still exposes `h.pos.x` — so the codegen still emits a nested sub-handle for the `pos` field and the sub-handle's `x` getter reads from the same `_col_pos_x` column array as the parent would. The sub-handle shares the parent's `_slot`.

At this task's scope, layout and codegen produce and consume column descriptors. The slab still builds a DataView and passes it to the old constructor path. Task-3 switches the slab to build TypedArray columns and pass them to the new constructor path.

### Strategy for keeping the old path alive during task-2

The simplest approach: keep `StructDef._Handle` pointing at the OLD generated constructor (DataView-based) so `slab.ts` keeps working unchanged, and add a NEW internal handle factory alongside that task-3 will wire to. Specifically:

- `src/struct/handle-codegen.ts` exports both:
  - `generateHandleClass(...)` — old DataView path, unchanged. Kept in place.
  - `generateSoAHandleClass(...)` — new TypedArray path. New function.
- `src/struct/layout.ts` exports both:
  - `computeLayout(...)` — old byte-offset layout, unchanged. Kept in place.
  - `computeColumnLayout(...)` — new column layout. New function.
- `src/struct/struct.ts` may attach the SoA handle factory to `StructDef` as a new internal field (e.g. `_SoAHandleFactory` or similar) if needed. If task-3 can do the wiring without changing `struct.ts`, skip this — the SoA factory can live as a pure function the slab calls. Builder decides based on what produces the smallest task-3 diff.

Both paths coexist through the end of task-2. Task-3 deletes the old path once everything is wired through the new one.

## Deliverables

### 1. `src/types.ts` — add `ColumnKey<F>` and `ColumnType<F, K>`

Edit `/Users/thada/gits/thaitype/rigidjs/src/types.ts`. All additions are appended.

Add these exported mapped types:

```ts
/**
 * Flattened dotted-key union of all columns reachable from a struct field map.
 * Top-level numeric fields contribute their own key.
 * Nested StructDef fields contribute `'<outer>.<inner>'` for every reachable
 * leaf in the nested struct, recursively.
 */
export type ColumnKey<F extends StructFields> = {
  [K in keyof F & string]:
    F[K] extends NumericType
      ? K
      : F[K] extends StructDef<infer G>
        ? `${K}.${ColumnKey<G> & string}`
        : never
}[keyof F & string]

/**
 * Given a struct field map F and a flattened column key K, resolves to the
 * concrete TypedArray subclass that backs that column.
 *
 *   'f64' → Float64Array
 *   'f32' → Float32Array
 *   'u32' → Uint32Array
 *   'u16' → Uint16Array
 *   'u8'  → Uint8Array
 *   'i32' → Int32Array
 *   'i16' → Int16Array
 *   'i8'  → Int8Array
 */
export type ColumnType<
  F extends StructFields,
  K extends ColumnKey<F>,
> = /* recursive resolver: walk the dotted key through F, hit the leaf numeric
       token, map it via NumericTokenToTypedArray below */ TypedArrayFor<
  ResolveLeafToken<F, K>
>
```

Builder fills in the recursive helpers (`ResolveLeafToken`, `TypedArrayFor`, or equivalent). The exact internal type machinery is up to the builder — the public surface is `ColumnKey<F>` and `ColumnType<F, K>` and those must satisfy the worked examples in `.chief/milestone-3/_contract/public-api.md`:

```ts
type V3 = { x: 'f64'; y: 'f64'; z: 'f64' }
type P  = { pos: StructDef<V3>; vel: StructDef<V3>; life: 'f32'; id: 'u32' }

// ColumnKey<P> ≡ 'pos.x'|'pos.y'|'pos.z'|'vel.x'|'vel.y'|'vel.z'|'life'|'id'
// ColumnType<P,'pos.x'> ≡ Float64Array
// ColumnType<P,'life'>  ≡ Float32Array
// ColumnType<P,'id'>    ≡ Uint32Array
```

Verify by adding a compile-time assertion file `tests/types/column-types.ts` (or similar — check existing pattern) that pins these types. If no such file exists yet, a small `tests/struct/column-types.test.ts` with runtime tautologies that exercise the types is acceptable.

Update the existing `StructDef<F>` interface if and only if the SoA wiring requires exposing a new internal factory field. Default: do not modify `StructDef` in this task; keep all SoA factory references as pure functions.

### 2. `src/struct/layout.ts` — add `computeColumnLayout(...)`

Edit `/Users/thada/gits/thaitype/rigidjs/src/struct/layout.ts`. `computeLayout(...)` stays in place untouched. Add `computeColumnLayout(...)` as a new exported function.

```ts
/** One column in the flattened SoA layout. */
export interface ColumnDesc {
  /** Flattened dotted-key name, e.g. 'pos.x', 'life', 'id'. */
  name: string
  /** Numeric token for this column, e.g. 'f64'. */
  token: NumericType
  /** Byte offset of the column's first element inside the struct's single buffer. Multiple of element size. */
  byteOffset: number
  /** Byte length of the column across all slots (elementSize * capacity). Computed at slab time, NOT here — this field is filled by the slab. Leave as 0 in compute. */
  byteLength: 0
}

/** Layout result for the SoA path. */
export interface ColumnLayout {
  /** Sum of column element sizes per slot — equals the old sizeof. */
  sizeofPerSlot: number
  /** Columns in natural-alignment-sorted order. Flattened across nested structs. */
  columns: readonly ColumnDesc[]
  /**
   * Traversal plan for building nested handle trees. Each entry describes
   * one handle object to construct: the root, or a sub-handle for a nested
   * struct field. Used by the codegen to know which columns each handle
   * object wraps.
   */
  handleTree: HandleNode
}

/** Tree node describing one level of the handle hierarchy. */
export interface HandleNode {
  /** Field path from the root (empty string for root). */
  path: string
  /** Numeric fields at this level (name → column descriptor reference). */
  numericFields: ReadonlyArray<{ name: string; column: ColumnDesc }>
  /** Nested struct fields at this level, each with its own sub-tree. */
  nestedFields: ReadonlyArray<{ name: string; child: HandleNode }>
}
```

Algorithm for `computeColumnLayout(fields: StructFields): ColumnLayout`:

1. **Flatten.** Walk the field tree depth-first. For every numeric leaf, emit a column with the dotted path as its name. Preserve original declaration order as a secondary key for later ties.
2. **Natural-alignment sort.** Sort the flattened list by **element size descending**, then by declaration order (stable sort). Column order becomes: all `f64` columns, then `f32`/`u32`/`i32` columns, then `u16`/`i16`, then `u8`/`i8`.
3. **Assign `byteOffset`.** Walk the sorted columns and assign each a byte offset equal to the running total of `<elementSize> * 1` — i.e. for per-slot offset computation. Because the list is sorted by element size descending, each column's byteOffset is automatically a multiple of its own element size: the first f64 column lands at 0, the next f64 column at 8, the first f32 column lands after all f64 columns (at a multiple of 8, which is also a multiple of 4), etc.
4. **Compute `sizeofPerSlot`.** This equals the running total at the end of the sort. Importantly: `sizeofPerSlot` must equal `sizeof` from the old `computeLayout(fields)` result, because the public contract says `StructDef.sizeof` is unchanged. The sort reorders columns but every field is still present, so the total byte footprint per slot is identical — just permuted.
5. **Build handle tree.** Walk the ORIGINAL declaration order (not the sort order) and record which numeric fields sit at each struct level and which nested struct fields exist. This is the structure the codegen uses to emit handle classes. The tree preserves declaration order because that is how `h.pos.x` resolves.

Invariants the builder must assert at compute time:

- `sizeofPerSlot === computeLayout(fields).sizeof` — byte-total parity with the old path. This is a runtime assertion in the layout function during task-2 (it can be removed in a future cleanup milestone once confidence is high).
- For every column, `byteOffset % elementSize === 0` — natural alignment holds. This is a runtime assertion.
- Every flattened leaf in `fields` appears exactly once in `columns` — completeness check. Runtime assertion.

Runtime assertions are permitted in `layout.ts` because layout runs once at `struct()` call time, not on hot paths.

### 3. `src/struct/handle-codegen.ts` — add `generateSoAHandleClass(...)`

Edit `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts`. `generateHandleClass(...)` stays in place untouched. Add `generateSoAHandleClass(...)` as a new exported function.

Signature:

```ts
/**
 * Descriptor for a TypedArray column reference at codegen time.
 * Internal — not part of the public contract.
 */
export interface ColumnRef {
  /** The dotted path to this column, e.g. 'pos.x'. Used as a lookup key. */
  name: string
  /** The concrete TypedArray instance to bake into the generated class. */
  array: Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array
}

export interface SoAHandleConstructor {
  /**
   * No-arg constructor — all column references are baked into the closure.
   * The constructor initializes _slot to 0 and constructs nested sub-handles.
   */
  new (slot: number): object
}

export function generateSoAHandleClass(
  handleTree: HandleNode,
  columnRefs: ReadonlyMap<string, ColumnRef>,
): SoAHandleConstructor
```

The generated class must satisfy these rules:

1. **No per-access allocation.** Getter body: `return this._c_pos_x[this._slot]`. Setter body: `this._c_pos_x[this._slot] = v`. No function calls, no dispatch, no closures, no array lookups through an indirection table.
2. **Monomorphic storage.** Each column ref is stored as a direct property on `this` (e.g. `this._c_pos_x = /* Float64Array */`), assigned once in the constructor. Because column refs are passed into the factory via `new Function()` parameter passing (same pattern as the existing DataView codegen uses for nested constructors), each class site captures a concrete TypedArray subclass and the JIT sees the same shape at every access point.
3. **Nested sub-handles.** For each nested struct field in `handleTree.nestedFields`, construct one sub-handle in the constructor and store it as `this._sub_<name>`. The sub-handle's class is generated by a recursive `generateSoAHandleClass` call on the child `HandleNode`. The sub-handle shares the parent's `_slot` by having its `_rebase` method called from the parent's `_rebase`.
4. **`_rebase` method.** Updates `this._slot = s` and recursively calls `_rebase` on each `_sub_<name>`. No DataView updates — there is no DataView in the SoA path. This is much simpler than the old path.
5. **`slot` public getter.** `get slot() { return this._slot }`. Same as before.
6. **Slot-field sanitization.** The dotted-path column name (`'pos.x'`) is not a valid JS identifier. The codegen must sanitize it when it names the instance field: `'pos.x'` → `this._c_pos_x` (replace `.` with `_`). Document the transform in a one-line comment.
7. **Constructor factory signature.** Like the old path, the outer factory function receives the column refs and child constructors as named parameters so the generated class captures them through the closure. Pattern:

   ```ts
   const factory = new Function(
     '_C_pos', '_C_vel',            // child constructors for nested fields
     '_col_pos_x', '_col_pos_y',    // column TypedArrays
     '_col_vel_x', /* ... */
     '_col_life', '_col_id',
     'return class Handle { /* ... */ }'
   )
   const HandleClass = factory(SubPos, SubVel, posXArr, posYArr, /* ... */)
   ```

8. **Constructor signature for the generated class.** `constructor(s) { this._slot = s; this._sub_pos = new _C_pos(s); /* ... */ }` — takes the initial slot, constructs nested sub-handles with the same slot. No `view` or `offset` parameters — there is no DataView in the new path.

The old `generateHandleClass(fields, offsets)` path continues to exist until task-3 deletes it. Do not remove it in this task even though nothing new uses it — the slab still calls it during task-2's intermediate state.

### 4. `src/struct/struct.ts` — optional minimal bridge

If `StructDef._Handle` must continue to point at the old constructor (which it must, for task-2 to not break the slab), leave `struct.ts` as-is.

If the builder chooses to attach the SoA factory as a new internal field (e.g. `_SoAHandleFactory`) so task-3 can discover it, that is acceptable. The field name is not part of any contract — it is internal. Mark it with a JSDoc `@internal` comment and prefix with underscore. The preferred approach is to keep `struct.ts` unchanged and have task-3 call the SoA layout + codegen functions directly from the slab, because that produces the smallest surface area and the smallest diff.

Builder picks whichever approach keeps the overall diff smallest and explains the choice in the task-2 report (see Deliverable §6).

### 5. Test updates (behaviour-preserving only)

- Existing behavioural tests in `tests/struct/**` and `tests/slab/**` must continue to pass without modification. Grep for tests that inspect `(h as any)._v` or `(h as any)._o` or `_offsets` directly — these are implementation-detail probes and may need minor adjustment, **but only if they actively break**. If they still pass because the slab still uses the old path, leave them alone in this task.
- Add one new test file exercising the new layout function in isolation, e.g. `tests/struct/column-layout.test.ts`:
  - `computeColumnLayout({ x: 'f64', y: 'f64', z: 'f64' })` returns three columns with byte offsets 0, 8, 16 and `sizeofPerSlot === 24`.
  - For a mixed struct like `{ life: 'f32', pos: Vec3 }`, verify the natural-alignment sort puts the f64 columns before the f32 column (so `pos.x` at 0, `pos.y` at 8, `pos.z` at 16, `life` at 24), total 28.
  - For a mixed struct with an f32 after f64, verify `byteOffset % 4 === 0` for the f32 column.
  - Completeness check: every numeric leaf in the input tree appears in `columns` exactly once.
  - Parity check: `computeColumnLayout(fields).sizeofPerSlot === computeLayout(fields).sizeof` for at least three distinct fixtures.
- Add a second test file `tests/struct/column-types.test.ts` (or similar) that compile-time-asserts `ColumnKey<P>` and `ColumnType<P, K>` match the worked examples in the contract. Runtime content can be trivial (`expect(true).toBe(true)`) — the assertion is the type annotation itself.

### 6. Task-2 report

Write `.chief/milestone-3/_report/task-2/notes.md` with:

- One-paragraph summary of what shipped in this task.
- The natural-alignment sort algorithm used and why it guarantees every `byteOffset` is a multiple of the column's element size.
- The sanitization rule for dotted-key → JS field name.
- Why `sizeofPerSlot === old sizeof` holds (sort is a permutation, not a resize).
- Where the SoA factory lives (pure function vs attached to `StructDef`) and why.
- Which tests were added and what they guard.
- Which tests were modified (should be zero or near-zero).

Keep it under ~1 page. This is an internal implementation log, not a user-facing document.

## Probe-Verify Step

After implementing layout and codegen, run the new column-layout tests and at least one ad-hoc sanity probe:

```
bun test tests/struct/column-layout.test.ts
bun test tests/struct/column-types.test.ts
```

Then verify every existing test still passes:

```
bun test
bun run typecheck
```

Finally, confirm the old DataView codegen path is still active for the slab by running a slab test file that reads a handle value back: `bun test tests/slab/slab-basic.test.ts` (or whatever the canonical basic slab test file is — grep to find it). The test should pass untouched because the slab has not been rewired yet.

## Acceptance Criteria

- [ ] `bun test` exits 0 with zero failing tests. Total test count has **increased** (new column-layout and column-types tests added).
- [ ] `bun run typecheck` exits 0.
- [ ] `ColumnKey<F>` and `ColumnType<F, K>` are defined and exported from `src/types.ts` and satisfy the worked examples in `.chief/milestone-3/_contract/public-api.md`.
- [ ] `src/struct/layout.ts` exports `computeColumnLayout(fields)` in addition to the unchanged `computeLayout(fields)`.
- [ ] For every fixture in the new tests, `computeColumnLayout(fields).sizeofPerSlot === computeLayout(fields).sizeof`.
- [ ] For every column in the new tests, `column.byteOffset % elementSize === 0` holds.
- [ ] `src/struct/handle-codegen.ts` exports `generateSoAHandleClass(handleTree, columnRefs)` in addition to the unchanged `generateHandleClass(...)`.
- [ ] `src/slab/slab.ts` is **unchanged**. `git diff src/slab/slab.ts` is empty.
- [ ] `benchmark/**` is unchanged. `git diff benchmark/` is empty.
- [ ] No new runtime dependencies. `package.json` byte-identical.
- [ ] No `/tmp` scripts, no external file writes. Every diagnostic is a committed file under `tests/` or `benchmark/`.
- [ ] No `Proxy` introduced. Grep confirms.
- [ ] `src/index.ts` re-exports `ColumnKey` and `ColumnType` as type-only exports, or task-3 will add that — decide during task-2 and document in notes. Default: add in task-2 so the public surface is complete before task-3 wires the runtime method.
- [ ] Task-2 notes exist at `.chief/milestone-3/_report/task-2/notes.md`.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-3/_plan/_todo.md`** — the chief-agent owns that checklist.

## Out of Scope

- Wiring `src/slab/slab.ts` to the new codegen path. That is task-3's job.
- Adding `slab.column()` method. Task-3.
- Running benchmarks. Task-3 / task-4.
- Deleting the old DataView codegen path. Task-3 — the deletion is part of the cutover.
- Editing `benchmark/**`, `examples/**`, or any rule file.
- String field types, `vec`, `bump`, `.iter`.

## Notes

- The sort-by-element-size-descending is the standard trick for padding-free natural alignment: if the largest element appears first, every subsequent element's offset is automatically a multiple of the running size sum, provided each element size is a power of two (which every TypedArray element size is). Reference: `rigidjs-improvement-report.md` §3.1.
- The handle tree preserves declaration order because that is the structure users see (`h.pos.x` traversal). The column list uses natural-alignment order because that is the structure the runtime sees (byte offsets in the buffer). Two orderings, one source of truth (the flattened leaf set).
- Sub-handles in the SoA path do NOT allocate column refs — they reuse the parent's column ref map. The `generateSoAHandleClass` recursion for a nested `pos` struct passes the same `columnRefs` map (filtered to keys starting with `pos.`) to the child codegen.
- The old DataView path (`generateHandleClass`) lives on in the same file throughout task-2. This is intentional: keeping both paths alive lets task-2's test suite run on the old path for the slab while the new path gets unit-tested in isolation.
- The runtime assertions in `computeColumnLayout` (byte total parity, alignment, completeness) are belt-and-braces and can be removed in a future cleanup milestone. For task-2, leave them in — they are cheap at `struct()` call time and catch codegen bugs before task-3 goes live.
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes, at least one new test per new public symbol.
