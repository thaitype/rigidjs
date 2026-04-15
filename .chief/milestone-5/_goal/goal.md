# Milestone 5 Goal -- Predictable, GC-Free Large Collections

## Strategic Context

**End goal:** All RigidJS operations >= 1x JS throughput.

**Direction A (primary):** Predictable, GC-free large collections -- all ops target >= 1x JS throughput with zero GC pressure on long-lived entities.

**Direction B (bonus):** Fast columnar processing -- already proven at 3-4x JS. Maintain and do not regress.

## Objective

Ship `forEach(cb)` for vec and slab as the primary handle-iteration API. Ship `vec.reserve(n)` to fix the B1-vec allocationDelta gate failure. Profile and optimize throughput bottlenecks in entity creation and insert/remove churn. Extend B8/B9 sustained-churn and heap-scaling benchmarks to vec. Re-run the full benchmark suite with per-process isolation to produce trustworthy numbers. Produce a gap analysis report documenting every operation still below 1x JS with root causes, paths to >= 1x, and estimated difficulty. Produce a concrete roadmap for future milestones.

## In Scope

1. **`vec.forEach(cb)` and `slab.forEach(cb)`** -- internal iteration via plain counted `for` loop calling user callback with rebased handle. No iterator protocol overhead.
2. **`vec.reserve(n)`** -- grow capacity to at least `n` without pushing entities. Eliminates repeated 2x doublings when final size is known.
3. **Per-process benchmark isolation** -- rewrite `benchmark/run.ts` to spawn each scenario in a separate `Bun.spawn()` subprocess. Eliminates JIT contamination between scenarios.
4. **Profile + optimize throughput bottlenecks** -- profile entity creation (B1) and insert/remove churn (B2) for both slab and vec. Identify and fix what is feasible within the existing architecture.
5. **B8-vec and B9-vec** -- extend sustained-churn and heap-scaling benchmarks to vec.
6. **Full suite re-run** with per-process isolation. Produce authoritative baseline numbers.
7. **Gap analysis report** -- for every operation still below 1x JS: root cause, path to >= 1x, estimated difficulty.
8. **Roadmap** -- concrete plan for how future milestones achieve the end goal for both Direction A and Direction B.

## Out of Scope (Deferred)

- `bump()` arena allocator
- `.iter()` lazy chains (filter/map/take/reduce)
- New struct field types (str:N, string)
- Documentation / README / npm publish
- Handle layer redesign (document in gap analysis if needed, defer to future milestone)
- `for..of` on slab

## Success Criteria

### Hard floors (must not regress -- block the milestone)

- All existing tests pass. `bun test` exits 0 with zero failing tests.
- `bun run typecheck` exits 0 with zero errors.
- Zero public API removals or renames from milestone-4.
- Zero runtime dependencies.
- No `Proxy` anywhere.
- B8 slab p99 <= 1ms.
- B1 slab allocationDelta <= 1,000.
- B7 slab allocationDelta <= 1,000.
- Vec column iteration >= 3.0x JS (preserve M4 win).
- Vec indexed get iteration >= 1.5x JS (preserve M4 win).

### Definition of Done

1. `forEach(cb)` shipped for vec and slab, with benchmark scenarios.
2. `vec.reserve(n)` shipped, B1-vec allocationDelta gate passes when pre-reserved.
3. Profile + optimize throughput bottlenecks (fix what we can).
4. B8/B9 extended to vec.
5. Full suite re-run with per-process isolation.
6. Gap analysis report -- for every operation still below 1x: root cause, path to >= 1x, estimated difficulty.
7. Roadmap -- concrete plan for future milestones to achieve end goal.

### Aspirational targets (report honestly, do not block)

| Scenario | Target |
|---|---|
| Vec forEach iteration (100k) | >= 1.5x JS |
| Slab forEach iteration (100k) | >= 1.0x JS |
| Vec column iteration (100k) | >= 3.0x JS (preserve M4 win) |
| Vec indexed get iteration (100k) | >= 1.5x JS (preserve M4 win) |
| B1-vec with reserve() allocationDelta | <= 500 |
| B8 slab p99 | <= 1ms (no regression) |

## Priority Order for Throughput Work

1. Iteration (`forEach`) -- most impactful for Direction A's sustained workload story.
2. Insert/remove -- profile and optimize.
3. Creation -- hardest gap, profile and see what is possible.

## Non-Negotiables

1. Profile BEFORE optimizing. No speculative optimization without profiling evidence.
2. Per-process benchmark isolation must be in place before the final suite re-run.
3. Benchmark code uses only public API.
4. `results.json` committed without time-series; `raw-timeseries.json` gitignored.
5. All benchmark numbers reported honestly with honest assessment of wins and losses.
