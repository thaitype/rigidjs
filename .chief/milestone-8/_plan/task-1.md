# Task 1: Cache SoA Handle Class Factory on StructDef

## Objective

Cache the SoA handle class *factory function* on `StructDef` so that `generateSoAHandleClass()` (which calls `new Function()`) runs at most once per struct definition. Subsequent calls to graduation, grow, reserve, and slab construction reuse the cached factory and only pass in the new column TypedArrays.

## Scope

**Included:**
- Refactor `generateSoAHandleClass()` to separate the factory (layout-dependent, cacheable) from the instantiation (column-dependent, per-call)
- Add a `_SoAHandleFactory` cache field on `StructDef` in `src/types.ts`
- Update `src/vec/vec.ts`: `_graduateToSoA()`, `_grow()`, `reserve()`, and the SoA constructor path to use the cached factory
- Update `src/slab/slab.ts` to use the cached factory
- Tests verifying the factory is cached (same factory reference across multiple vec/slab instances of the same struct)

**Excluded:**
- Changes to JS mode codegen (already cached via `_JSFactory`)
- Performance benchmarking (task-6)

## Rules & Contracts to Follow

- `.chief/_rules/_verification/verification.md`
- `.chief/_rules/_standard/` (no runtime deps, strict TS)
- `CLAUDE.md` architecture rules (no Proxy, code-generated handles, ESM only)

## Steps

1. Analyze `generateSoAHandleClass()` in `src/struct/handle-codegen.ts`. Identify which parts depend on struct layout only (the `new Function()` body and parameter names) vs which parts depend on runtime column TypedArrays (the factory arguments).
2. Split into two functions:
   - `generateSoAHandleFactory(handleTree)` -- returns a factory function `(...columnArgs) => SoAHandleConstructor`. This is the cacheable part.
   - Keep `generateSoAHandleClass(handleTree, columnRefs)` as a convenience that calls the factory. Or replace its call sites with direct factory usage.
3. Add `_SoAHandleFactory?: (...args: unknown[]) => new (slot: number) => object` to `StructDef` in `src/types.ts`.
4. In `src/vec/vec.ts`, cache the factory on first use (same pattern as `_JSFactory`):
   - In `_graduateToSoA()`, `_grow()`, `reserve()`: use `def._SoAHandleFactory` if present, else generate and cache.
   - Pass current `columnRefs` to the factory to get the handle class.
5. In `src/slab/slab.ts`: same caching pattern.
6. Write tests in `tests/` confirming:
   - Two `vec(T)` instances share the same `_SoAHandleFactory` on the StructDef
   - Graduation works correctly with cached factory
   - `slab(T, n)` uses the same cached factory

## Acceptance Criteria

- [ ] `new Function()` is called at most once per StructDef for SoA handle generation
- [ ] `def._SoAHandleFactory` is set after first graduation/slab creation and reused thereafter
- [ ] All existing tests pass (`bun test`)
- [ ] `bun run typecheck` passes
- [ ] New test confirms factory caching across multiple container instances

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- Modified: `src/struct/handle-codegen.ts`, `src/types.ts`, `src/vec/vec.ts`, `src/slab/slab.ts`
- New/modified: test file(s) in `tests/`
