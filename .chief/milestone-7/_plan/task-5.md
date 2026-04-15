# Task 5: Benchmark Validation + M7 Summary Report

**Status:** Not started
**Type:** Verification / Report
**Estimated effort:** 45-60 minutes
**Depends on:** Tasks 1-4

## Objective

Run the full benchmark suite against the hybrid vec to validate that (a) small-scale performance matches JS and (b) large-scale performance has no regression. Write the M7 summary report.

## Scope

**In scope:**
- Add new small-scale benchmark scenarios for hybrid vec (JS mode) if not already covered
- Run all existing benchmark scenarios
- Run new hybrid-specific benchmarks:
  - Small N (10, 100) creation with `vec(T)` (JS mode)
  - Small N churn with `vec(T)` (JS mode)
  - Graduation timing (measure the spike at N=128)
  - Large N (100k) post-graduation performance (should match current SoA)
- Compare results against M6 baselines from `.chief/milestone-6/_report/task-4/gap-analysis.md`
- Write M7 summary report

**Out of scope:**
- Code changes to fix performance issues (would be a new task if needed)
- New features

## Rules & Contracts

- `.chief/_rules/_verification/verification.md`
- `.chief/milestone-7/_goal/hybrid-vec-design-spec.md` -- Section 6 (Expected Performance) and Section 10 (Success Criteria)

## Steps

### 5a: Create Hybrid-Specific Benchmark Scenarios

If not already present, add scenarios under `benchmark/scenarios/`:

1. **b1-hybrid-small.ts**: Creation benchmark for `vec(T)` (no capacity) at N=10, 100, 1000. Compare against plain JS `Array.push({...})`.
2. **b2-hybrid-small.ts**: Churn benchmark for `vec(T)` at N=10, 100, 1000.
3. **b10-graduation.ts**: Measure graduation spike. Push from 0 to 256 in a `vec(T, { graduateAt: 128 })`, time the graduation event specifically.

### 5b: Run Full Suite

Run each scenario in a separate process for JIT isolation:

```bash
# Existing large-scale (should show no regression)
bun run benchmark/run-scenario.ts -s b2-vec-churn
bun run benchmark/run-scenario.ts -s b3-vec-get
bun run benchmark/run-scenario.ts -s b3-vec-forEach
bun run benchmark/run-scenario.ts -s b3-vec-column
bun run benchmark/run-scenario.ts -s b8-vec-sustained

# New hybrid small-scale
bun run benchmark/run-scenario.ts -s b1-hybrid-small
bun run benchmark/run-scenario.ts -s b2-hybrid-small
bun run benchmark/run-scenario.ts -s b10-graduation
```

Note: The existing large-scale scenarios use `vec(T, capacity)` which routes to SoA mode immediately -- they should show identical performance to M6.

### 5c: Analyze Results

Build the comparison table:

| Scenario | M6 Ratio | M7 Ratio | Delta | Status |
|----------|----------|----------|-------|--------|
| B2-vec churn 100k | 2.83x | ? | ? | PASS/FAIL |
| B3-vec-get 100k | 2.55x | ? | ? | PASS/FAIL |
| B3-vec-forEach 100k | 1.15x | ? | ? | PASS/FAIL |
| B3-vec-column 100k | 1.67x | ? | ? | PASS/FAIL |
| B8-vec sustained | N/A | ? | ? | PASS/FAIL |
| B1-hybrid N=10 | N/A | ? | target ~1.0x | ? |
| B1-hybrid N=100 | N/A | ? | target ~1.0x | ? |
| B2-hybrid N=10 | N/A | ? | target ~1.0x | ? |
| B2-hybrid N=100 | N/A | ? | target ~1.0x | ? |
| B10-graduation | N/A | ? | target <50us | ? |

### 5d: Write M7 Summary Report

Write `.chief/milestone-7/_report/task-5/m7-summary.md` covering:

1. **What shipped:** Hybrid vec with JS mode, auto-graduation, options API
2. **Performance results:** Full table with analysis
3. **Success criteria evaluation:** Check each criterion from the design spec Section 10
4. **Remaining gaps:** Any operations still below target
5. **Recommendations for M8**

## Acceptance Criteria

- [ ] All benchmark scenarios run without errors
- [ ] Large-scale scenarios show no regression (within 5% of M6 numbers, accounting for JIT variance)
- [ ] Small-scale JS mode scenarios show approximately 1.0x JS performance (>= 0.8x)
- [ ] Graduation spike at N=128 is < 50us
- [ ] M7 summary report is complete and filed
- [ ] Report explicitly evaluates all 5 success criteria from the design spec

## Verification

```bash
bun test
bun run typecheck
```

Plus all benchmark commands listed above.

## Deliverables

- New benchmark scenarios in `benchmark/scenarios/` (if created)
- `.chief/milestone-7/_report/task-5/m7-summary.md` -- final M7 report
- `.chief/milestone-7/_report/task-5/results.json` -- raw benchmark data (optional, builder discretion)
