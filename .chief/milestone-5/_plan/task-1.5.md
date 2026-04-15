# Task 1.5: Split JS Baseline and RigidJS into Separate Processes

## Objective

Restructure benchmark scenario files so JS baseline and RigidJS variants can be invoked independently in separate subprocesses. This ensures complete JIT isolation between the two — JS baseline's JIT optimizations do not leak into the RigidJS run.

## Context

Task-1 achieved per-scenario-file isolation (each scenario file runs in its own process). However, within a single scenario file, JS baseline and RigidJS still share a process. The scenario files currently export both variants in one array:

```ts
export const scenarios = [jsBaseline, rigidVariant]
```

## Scope

**Included:**
- Restructure scenario files so each variant (JS / Rigid) can be run independently.
- Update `benchmark/run-scenario.ts` to accept a variant selector (e.g. `--variant js` or `--variant rigid`).
- Update `benchmark/run.ts` to spawn two sequential processes per scenario: one for JS, one for RigidJS.
- Comparison/output logic remains in the parent process.

**Excluded:**
- No new benchmark scenarios.
- No changes to `benchmark/harness.ts` core measurement logic.
- No changes to source code under `src/`.

## Steps

1. Read all scenario files under `benchmark/scenarios/` to understand the current export shape.
2. Design a variant selection mechanism — either split exports (`export const js = ...`, `export const rigid = ...`) or accept a filter flag in run-scenario.ts.
3. Update scenario files to support independent variant execution.
4. Update `run-scenario.ts` to accept `--variant` flag and run only the selected variant.
5. Update `run.ts` to spawn JS first → collect result → spawn RigidJS → collect result → compare.
6. Handle B8 (sustained) and B9 (scaling) scenarios which may have different variant structures.

## Acceptance Criteria

- [ ] For each scenario, JS baseline and RigidJS run in separate OS processes.
- [ ] `bun run bench` still works end-to-end (all scenarios sequential, each variant sequential).
- [ ] `bun run bench -s B1-slab` runs JS then RigidJS in separate processes.
- [ ] Output format unchanged (results.json + raw-timeseries.json).
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.

## Verification

```bash
bun test
bun run typecheck
bun run bench -s B1-slab
```
