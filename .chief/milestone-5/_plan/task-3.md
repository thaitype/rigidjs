# Task 3: Profile Throughput Bottlenecks

## Objective

Profile entity creation (B1) and insert/remove churn (B2) for both slab and vec. Identify root causes of the throughput gap vs JS. Implement fixes for bottlenecks that are feasible within the existing architecture. Document findings with evidence.

## Scope

**Included:**
- Profile B1-slab (0.24x JS), B1-vec (0.34x JS), B2-slab (0.68x JS), B2-vec (0.47x JS).
- Use `Bun.nanoseconds()` micro-timers to break down per-operation costs (e.g., for slab.insert(): free-list pop time, handle rebase time, field-write time).
- Identify which sub-operations dominate the gap.
- Implement fixes for any bottleneck that can be addressed without architectural redesign.
- Re-run affected scenarios to measure impact of fixes.
- Write profiling findings report.

**Excluded:**
- No handle layer redesign (if profiling shows the handle itself is the bottleneck, document it in findings and defer to gap analysis).
- No changes to benchmark harness (task-1 handles that).
- No new benchmark scenarios beyond re-running existing ones.

## Rules & Contracts to Follow

- `.chief/_rules/_standard/memory-and-perf.md` -- no per-call allocation in hot paths. Any optimization must maintain this invariant.
- `.chief/_rules/_contract/public-api.md` -- no API changes. Optimizations are internal only.
- `.chief/_rules/_verification/verification.md` -- bun test + typecheck must pass after any changes.

## Steps

1. **Instrument slab.insert():** Add Bun.nanoseconds() timers around each sub-step (free-list pop, bitmap set, handle rebase, field zeroing if any). Run B1-slab 1000x, collect average per-step times. Identify dominant cost.
2. **Instrument vec.push():** Same approach for vec. Measure: len check, growth check, handle rebase, column write. Separate out the growth path vs the non-growth path.
3. **Instrument slab insert/remove cycle:** For B2, measure per-operation: insert cost vs remove cost. Is one side dominating?
4. **Instrument vec push/swapRemove cycle:** Same for B2-vec.
5. **Compare to JS baseline instrumentation:** Instrument the JS baseline equivalents to understand where JS wins.
6. **Analyze findings:** Identify which sub-operations cause the gap. Categorize as: (a) fixable now, (b) requires architectural change, (c) fundamental JS engine advantage.
7. **Implement fixes** for category (a) items.
8. **Re-run affected scenarios** to verify improvement.
9. **Write findings report** with per-step timing data, root causes, and fix results.

## Acceptance Criteria

- [ ] Profiling findings written to `.chief/milestone-5/_report/task-3/profiling-findings.md`.
- [ ] Each slow operation (B1-slab, B1-vec, B2-slab, B2-vec) has per-step timing breakdown.
- [ ] Root causes identified and categorized.
- [ ] Feasible fixes implemented (if any found).
- [ ] `bun test` exits 0 after any changes.
- [ ] `bun run typecheck` exits 0 after any changes.

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- `.chief/milestone-5/_report/task-3/profiling-findings.md`
- Any source changes under `src/slab/` or `src/vec/` (if optimizations are made)
- Updated tests if behavior changes
