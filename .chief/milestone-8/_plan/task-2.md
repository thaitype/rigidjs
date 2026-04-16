# Task 2: Lazy VecImpl Property Init for JS Mode

## Objective

Reduce VecImpl constructor cost in JS mode by deferring initialization of SoA-related properties that are never read until graduation. At N=10, constructor overhead is 71% of total time and the vec never graduates.

## Scope

**Included:**
- Identify which VecImpl instance properties are unused in JS mode
- Defer their initialization: either don't set them at all in JS mode (set in `_graduateToSoA()` instead), or use a lazy pattern
- Measure property count reduction (target: 5-6 fewer assignments in JS-mode constructor)
- Tests confirming JS mode and graduation still work correctly

**Excluded:**
- Changes to SoA-mode constructor path (that path needs all properties immediately)
- VecImpl instance pooling (deferred to future milestone)
- Benchmark measurement (task-6)

## Rules & Contracts to Follow

- `.chief/_rules/_verification/verification.md`
- `.chief/_rules/_standard/`
- `CLAUDE.md` architecture rules

## Steps

1. Audit VecImpl constructor. List all instance properties and whether they are read in JS mode before graduation:
   - `_len`, `_dropped`, `_mode`, `_graduateAt` -- always needed
   - `_items`, `_factory` -- JS mode only
   - `_buf`, `_capacity` -- set to null/0 in JS mode, read only in SoA mode
   - `_columnMap`, `_columnRefs`, `_columnArrays` -- set to empty Map/array, never read in JS mode
   - `_swapFn` -- set to no-op, never called in JS mode
   - `_HandleClass`, `_handle` -- set to null, never read in JS mode
   - `_layout`, `_def` -- always needed (used in graduation)
2. For JS-mode construction, skip initializing: `_columnMap`, `_columnRefs`, `_columnArrays`, `_swapFn`, `_HandleClass`, `_handle`, `_buf`, `_capacity`. These 8 properties can be deferred.
3. In `_graduateToSoA()`, initialize these properties before use. The method already sets most of them -- verify completeness.
4. In SoA-mode constructor path, keep existing initialization (all properties needed immediately).
5. Verify that `_assertLive()`, `clear()`, `drop()`, `capacity` getter, `buffer` getter, `column()`, `reserve()` all still work in JS mode without the deferred properties (they all check `_mode === 'js'` first).
6. Run all existing tests to confirm no regressions.

## Acceptance Criteria

- [ ] JS-mode VecImpl constructor does not initialize `_columnMap`, `_columnRefs`, `_columnArrays`, `_swapFn`, `_HandleClass`, `_handle`
- [ ] `_buf` and `_capacity` are not initialized in JS mode (or use a different pattern)
- [ ] Graduation still works correctly (all deferred properties are initialized before use)
- [ ] All existing tests pass (`bun test`)
- [ ] `bun run typecheck` passes

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- Modified: `src/vec/vec.ts`
- No new files expected (existing tests should cover the behavior)
