# Task 4: B8-vec, B9-vec Sustained Benchmarks + Full Suite Re-Run

## Objective

Extend the B8 (sustained churn) and B9 (heap scaling curve) benchmark scenarios to vec. Run the complete benchmark suite with per-process isolation (from task-1). Produce the authoritative milestone-5 results.

## Scope

**Included:**
- `benchmark/scenarios/b8-vec-sustained.ts` -- sustained push/swapRemove churn on vec over 10 seconds. Measures mean tick, p50, p99, p999, max tick, heap time series. Same structure as B8-slab.
- `benchmark/scenarios/b9-vec-scaling.ts` -- heap scaling curve for vec at 1k, 10k, 100k, 500k entities. Same structure as B9-slab.
- Wire both new scenarios into `benchmark/run.ts`.
- Run the full benchmark suite (all slab + all vec + JS baselines) with per-process isolation.
- Produce `results.json` and `raw-timeseries.json` under `.chief/milestone-5/_report/task-4/`.
- Include B3-vec-forEach and B3-slab-forEach results (from task-2 scenarios).

**Excluded:**
- No new optimization work. This is a measurement task.
- No changes to harness logic.

## Rules & Contracts to Follow

- `.chief/_rules/_verification/verification.md` -- bun test + typecheck must pass.
- `.chief/milestone-5/_goal/goal.md` -- per-process isolation, honest reporting.

## Steps

1. Create `benchmark/scenarios/b8-vec-sustained.ts` modeling the B8-slab pattern: 10s sustained loop with push/swapRemove churn on a pre-allocated vec. Record per-tick times and heap snapshots.
2. Create `benchmark/scenarios/b9-vec-scaling.ts` modeling the B9-slab pattern: create vec at 1k, 10k, 100k, 500k capacities, measure heapSize, RSS, objectCount at each scale.
3. Wire both into `benchmark/run.ts`.
4. Run `bun run bench` with per-process isolation active.
5. Copy results to `.chief/milestone-5/_report/task-4/`.
6. Verify hard floor gates: B8 slab p99 <= 1ms, B1 slab allocationDelta <= 1000, vec column >= 3.0x JS.

## Acceptance Criteria

- [ ] B8-vec and B9-vec scenarios exist and run successfully.
- [ ] Full suite runs with per-process isolation (each scenario in its own process).
- [ ] `results.json` produced with all scenarios (slab + vec + forEach variants).
- [ ] All hard floor gates pass.
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.

## Verification

```bash
bun test
bun run typecheck
bun run bench
```

## Deliverables

- `benchmark/scenarios/b8-vec-sustained.ts`
- `benchmark/scenarios/b9-vec-scaling.ts`
- Updated `benchmark/run.ts` (wire new scenarios)
- `.chief/milestone-5/_report/task-4/results.json`
- `.chief/milestone-5/_report/task-4/raw-timeseries.json` (gitignored)
