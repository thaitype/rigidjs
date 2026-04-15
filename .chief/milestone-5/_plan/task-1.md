# Task 1: Per-Process Benchmark Isolation

## Objective

Rewrite `benchmark/run.ts` so each benchmark scenario runs in its own `Bun.spawn()` subprocess. This eliminates JIT contamination between scenarios and produces trustworthy, cross-milestone-comparable numbers.

## Scope

**Included:**
- Rewrite `benchmark/run.ts` to spawn each scenario as a separate Bun process.
- Each scenario file must export a self-contained runner that prints JSON results to stdout.
- Parent process collects results from all subprocesses and aggregates into the same output format as today (results.json + raw-timeseries.json split).
- Existing scenario files (`benchmark/scenarios/*.ts`) may need a thin wrapper or entry-point adaptation.
- The `bun run bench` command must still work end-to-end.

**Excluded:**
- No new benchmark scenarios in this task.
- No changes to `benchmark/harness.ts` core measurement logic (runAll, benchSustained, benchScaling).
- No changes to any source code under `src/`.

## Rules & Contracts to Follow

- `.chief/_rules/_verification/verification.md` -- bun test + typecheck must pass.
- `.chief/_rules/_standard/memory-and-perf.md` -- benchmark code uses only public API.
- `.chief/milestone-5/_goal/goal.md` -- per-process isolation requirement.

## Steps

1. Design the subprocess communication protocol: each scenario subprocess prints a JSON object to stdout with its results. Parent reads stdout after process exits.
2. Create a scenario entry-point pattern: each scenario file exports a `run()` async function that returns structured results. A thin CLI wrapper (or the file itself when run directly) calls `run()` and writes JSON to stdout.
3. Rewrite `benchmark/run.ts` to iterate over scenario files, `Bun.spawn()` each one, collect stdout JSON, and aggregate into the final report.
4. Handle sustained (B8) and scaling (B9) scenarios which have different result shapes.
5. Preserve the write-split logic (results.json scalar-only, raw-timeseries.json gitignored).
6. Run the full suite and verify: (a) each scenario runs in isolation, (b) output format is compatible with existing report expectations, (c) JS baselines are consistent across scenarios (no JIT contamination).

## Acceptance Criteria

- [ ] `bun run bench` executes successfully end-to-end.
- [ ] Each scenario runs in a separate OS process (verify via process IDs or by confirming no shared JIT state).
- [ ] Output produces results.json and raw-timeseries.json in the same format as milestone-4.
- [ ] JS baselines for equivalent workloads (e.g. B2-slab JS vs B2-vec JS) are within 20% of each other (evidence of no JIT contamination).
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.

## Verification

```bash
bun test
bun run typecheck
bun run bench
```

Manually inspect results.json to confirm JS baselines are consistent.

## Deliverables

- Modified `benchmark/run.ts`
- Modified or new scenario entry-point wrappers under `benchmark/scenarios/`
- Any new helper files under `benchmark/`
