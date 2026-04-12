# Task 5 -- Benchmark Scenarios + Final Report

## Objective

Add new benchmark scenarios for vec (B1-vec, B2-vec, B3-vec-handle, B3-vec-column, B3-partial), run the full benchmark suite including all existing slab scenarios, produce a comprehensive benchmark report comparing vec vs slab vs plain JS, and write the milestone-4 summary. Verify all hard floor gates pass.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_goal/goal.md` -- performance gates and hard floors
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_contract/public-api.md`
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_report/task-4/benchmark.md` -- milestone-3 baseline to compare against
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_report/task-4/results.json` -- milestone-3 raw numbers
9. Current benchmark source:
   - `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`
   - `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`
   - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/` -- existing slab scenarios (reference pattern)

## Scope Guardrails

- **Edits to:** `benchmark/**` (new scenario files, possibly minor edits to `run.ts` to include new scenarios). Report files under `.chief/milestone-4/_report/`.
- **Do NOT edit** `src/**`, `tests/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, `package.json`, `tsconfig.json`.
- **No new runtime dependencies.**
- **No `/tmp` scripts.**
- **Benchmark code uses only the public API.** Import from `'../../src/index.js'` only. No deep imports into `src/vec/**`, `src/slab/**`, `src/struct/**`.
- **Existing slab benchmark scenarios must not be modified.** Slab results must be directly comparable to milestone-3.

## Deliverables

### 1. New benchmark scenarios

Create new scenario files under `benchmark/scenarios/`:

**`b1-vec-creation.ts`** -- B1-vec: Create 100k entities via `vec.push()`.
- JS baseline: same as B1 (create 100k plain JS objects).
- RigidJS vec: create a vec, push 100k entities with field writes.
- Key metrics: ops/s, heapObjectsDelta.

**`b2-vec-churn.ts`** -- B2-vec: Push/swapRemove churn.
- JS baseline: same as B2 (array push/splice equivalent).
- RigidJS vec: push N entities, then alternating push + swapRemove. Match the B2 slab churn pattern (10k operations per iteration).
- Key metrics: ops/s, p99 latency.

**`b3-vec-handle.ts`** -- B3-vec-handle: Iterate 100k entities via `for..of vec`.
- JS baseline: same as B3 (iterate array of plain JS objects).
- RigidJS vec: iterate via `for..of` with handle field access and mutation.
- Key metrics: ops/s.

**`b3-vec-column.ts`** -- B3-vec-column: Iterate 100k entities via `vec.column()` direct TypedArray.
- JS baseline: same as B3.
- RigidJS vec: resolve columns once, iterate via pure TypedArray loop over `vec.len`.
- Key metrics: ops/s.

**`b3-partial.ts`** -- B3-partial: Iterate a 50%-full container.
- Create a slab with capacity 200k, insert 100k entities (50% full). Iterate with has() check + handle access.
- Create a vec, push 100k entities (100% full, len = 100k). Iterate via for..of.
- JS baseline: iterate an array of 100k plain JS objects.
- Key metrics: ops/s. This scenario demonstrates vec's dense-packing advantage over slab when the slab has holes.

### 2. Wire new scenarios into `benchmark/run.ts`

Add the new scenarios to the benchmark runner. Ensure they run alongside existing slab scenarios. The output must include both slab and vec results in the same run for direct comparison.

### 3. Run full benchmark suite

Run `bun run bench` with all scenarios (existing slab: B1, B2, B3, B3-column, B7, B8, B9 + new vec: B1-vec, B2-vec, B3-vec-handle, B3-vec-column, B3-partial).

### 4. Write benchmark report

Write `.chief/milestone-4/_report/task-5/results.json` with scalar benchmark data (no time-series arrays -- those go in `raw-timeseries.json` which is gitignored).

Write `.chief/milestone-4/_report/task-5/benchmark.md` in the same style as milestone-3's task-4 benchmark report. Must include:

**Front matter:** Bun version, platform, date, predecessor report reference.

**What This Means For You (End-User Impact):**
- When to use vec vs slab vs plain JS.
- Concrete throughput numbers translated to real workload terms (microseconds per 100k-entity sweep, frame budget implications).
- Honest assessment of where vec wins, where it is at parity, and where it still loses.
- Column-ref invalidation caveat for growth.
- swapRemove vs remove performance guidance.

**Slab vs Vec vs JS comparison table:**
- All B-scenarios with ops/s, ratio vs JS, and ratio vs milestone-3 baseline.
- Highlight improvements and regressions.

**Vec-specific results:**
- B1-vec, B2-vec, B3-vec-handle, B3-vec-column, B3-partial with detailed analysis.

**Slab free-list optimization results:**
- B2 slab before (milestone-3) vs after (milestone-4 with Uint32Array free-list).

**Allocation pressure:** heapObjectsDelta for vec scenarios. Verify <= 1000.

**Tail latency:** Any sustained-load vec scenarios if applicable. At minimum, verify slab B8 p99 <= 1ms (no regression).

**JIT compile deltas:** dfg/ftl deltas for vec scenarios.

**Gate-check verdict:** Checklist of all hard floor gates with pass/fail and actual values.

**Aspirational target outcomes:** Table with target vs actual for each aspirational metric.

**Honest limits:** Single machine, single run, measurement caveats.

### 5. Write milestone-4 summary

Write `.chief/milestone-4/_report/milestone-4-summary.md` as the canonical milestone wrap:
- What shipped (vec container, slab optimization).
- Key performance outcomes.
- What was deferred.
- Recommendations for milestone-5.

## Acceptance Criteria

- [ ] `bun test` exits 0 (verify no regressions from benchmark additions).
- [ ] `bun run typecheck` exits 0.
- [ ] All new benchmark scenario files exist under `benchmark/scenarios/`.
- [ ] `bun run bench` completes successfully with all scenarios.
- [ ] `.chief/milestone-4/_report/task-5/results.json` exists with scalar data.
- [ ] `.chief/milestone-4/_report/task-5/benchmark.md` exists with full report.
- [ ] `.chief/milestone-4/_report/milestone-4-summary.md` exists.
- [ ] `results.json` does NOT contain time-series arrays (`raw-timeseries.json` is gitignored).
- [ ] All hard floor gates verified and documented in the gate-check section.
- [ ] No slab benchmark regressions (B1, B2, B3, B7, B8 ratios within noise of milestone-3).
- [ ] `src/**`, `tests/**`, `examples/**` unchanged.
- [ ] No new runtime dependencies.
- [ ] No `/tmp` scripts.
- [ ] Benchmark code imports only from the public API.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-4/_plan/_todo.md`**.

## Out of Scope

- Source code changes (all implementation is complete by task-4).
- New test code (all correctness tests are complete by task-3).
- B4/B5/B6 scenarios (require `.iter()`, `bump` -- future milestones).
- Sustained-load vec scenario (B8-vec equivalent) -- could be added in milestone-5 with `.iter()`.

## Notes

- The B3-partial scenario is the key "receipts" scenario for vec: it shows that vec iteration over a dense 100k-element container is faster than slab iteration over a 50%-full 200k-slot container, because vec has no holes to skip and no has() checks. Even though both contain the same number of live entities, vec should win by a significant margin.
- For B2-vec churn, use `swapRemove` (not `remove`) as the removal operation. swapRemove is the intended hot-path removal API. `remove` is the slow path and should not be benchmarked as the primary churn operation.
- All benchmark scenarios must use the public API only: `import { struct, slab, vec } from '../../src/index.js'`. No internal imports.
- The milestone-3 benchmark baseline is at `.chief/milestone-3/_report/task-4/{results.json, benchmark.md}`. Use these numbers for before/after comparison on slab scenarios.
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes.
