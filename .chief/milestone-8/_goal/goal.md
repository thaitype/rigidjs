# Milestone 8: Polish, Correctness, and Codegen Caching

## Summary

M8 closes performance gaps identified in M7 (codegen caching, constructor overhead), adds structured error handling (RigidError), adds mutation guards for iteration safety, and runs a background-grow feasibility study.

## Goals

### G1: Cache SoA codegen on StructDef

`generateSoAHandleClass()` and `computeColumnLayout()` are called on every graduation, grow, and reserve. The handle class depends only on struct layout + column TypedArrays. The *class factory* (the `new Function()` output) depends only on struct layout and can be cached on StructDef. Column TypedArrays must still be passed per-instance.

**Target:** Eliminate repeated `new Function()` calls during graduation. Fix the N=1000 graduation benchmark (currently 0.10x) where repeated graduation per iteration is the bottleneck.

### G2: Lazy VecImpl property init

VecImpl constructor initializes ~15 instance properties. At N=10, constructor cost is 71% of total. SoA-related properties (`_columnMap`, `_columnRefs`, `_columnArrays`, `_swapFn`, `_HandleClass`, `_handle`) are unused in JS mode and can be deferred.

**Target:** Improve N=10 creation from 0.55x toward 0.7-0.8x.

### G3: RigidError + consistent error handling

Create a `RigidError` class with a `.code` property for structured error identification. Replace all `Error`/`RangeError`/`TypeError` throws in vec and slab. Add `assertLive` and bounds checks back to JS mode vec methods (they were stripped for performance in M7 but this creates inconsistent behavior between modes).

**Target:** Same error behavior in JS and SoA modes. Users can catch `RigidError` and switch on `.code`.

### G4: Mutation guard

Add `_iterating` flag to vec and slab. Set during `forEach` and `for..of`, clear on exit (try/finally). Mutating methods (`push`, `pop`, `swapRemove`, `remove`, `clear`, `drop`) check the flag and throw `RigidError` with code `MUTATION_DURING_ITERATION`.

**Target:** Prevent subtle bugs from mutating a container during iteration.

### G5: Background grow POC

Write a standalone script in `tmp/` that tests `SharedArrayBuffer` + `Worker` on Bun. Measure copy speed and Worker message overhead. Write findings to `_report/`. No changes to vec -- viability test only.

**Target:** PASS/FAIL verdict on whether background grow is worth pursuing in M9.

### G6: Benchmark re-run + updated reports

Run full benchmark suite and small-scale suite with n=20. Measure the performance impact of re-adding assertLive/bounds checks to JS mode (G3). Update reports with new numbers.

## Success Criteria

1. `bun test` passes, `bun run typecheck` passes
2. SoA handle class factory is cached on StructDef -- graduation does not call `new Function()` after first use
3. VecImpl JS-mode construction initializes fewer SoA-related properties (lazy or absent)
4. All throws in vec and slab use `RigidError` with `.code`
5. Mutation during forEach/for..of throws `RigidError` with code `MUTATION_DURING_ITERATION`
6. Background grow POC script exists in `tmp/` with findings in `_report/`
7. Updated benchmark report in `_report/`

## Dependencies

- Task 4 depends on Task 3 (needs RigidError)
- Task 6 depends on Tasks 1-4 (measures their impact)
- Tasks 1, 2, 3, 5 are independent of each other
