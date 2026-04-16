# Task 6: Full Benchmark Re-run + Updated Reports

## Objective

Run the full benchmark suite and small-scale hybrid benchmarks after tasks 1-4 are complete. Measure the performance impact of:
- SoA codegen caching (task 1) on N=1000 graduation
- Lazy property init (task 2) on N=10 creation
- Re-added assertLive/bounds checks in JS mode (task 3) on N=10 and N=100
- Mutation guard overhead (task 4) on forEach

**Depends on:** Tasks 1, 2, 3, 4 (all must be complete before this task).

## Scope

**Included:**
- Run full benchmark suite (large-scale: 10k, 100k, 1M entities)
- Run small-scale hybrid benchmarks with `-n 20` for stable medians
- Compare results to M7 baselines in `.chief/milestone-7/_report/final-progress-report.md`
- Write updated report to `.chief/milestone-8/_report/task-6/benchmark-report.md`
- Highlight regressions (if any) from added JS-mode checks

**Excluded:**
- Code changes (this is measurement only)
- Changes to benchmark scripts

## Rules & Contracts to Follow

- `.chief/_rules/_verification/verification.md`
- Use same benchmark methodology as M7: per-process JIT isolation, n=20 medians with stddev for small-scale

## Steps

1. Verify all tests pass: `bun test && bun run typecheck`
2. Run small-scale hybrid benchmarks with n=20:
   - B1-hybrid (creation): N=10, N=100, N=1000
   - B2-hybrid (churn): N=10, N=100, N=1000
   - B3-vec-get (indexed loop): N=10, N=100, N=1000
3. Run full-scale benchmarks:
   - All B1-B9 scenarios at standard sizes (10k, 100k, 1M where applicable)
4. Compile results into `.chief/milestone-8/_report/task-6/benchmark-report.md`:
   - Table: M7 baseline vs M8 results for each scenario
   - Analysis of codegen caching impact on N=1000
   - Analysis of lazy init impact on N=10
   - Analysis of assertLive/bounds check overhead in JS mode
   - Analysis of mutation guard overhead on forEach
5. Update `.chief/milestone-8/_report/task-6/` with raw benchmark data (JSON or text).

## Acceptance Criteria

- [ ] `bun test` and `bun run typecheck` pass before benchmarking
- [ ] Small-scale benchmarks run with n=20 and report medians + stddev
- [ ] Full-scale benchmarks run for all scenarios
- [ ] Report compares M8 vs M7 baselines
- [ ] Report calls out any regressions and their root causes
- [ ] Report exists at `.chief/milestone-8/_report/task-6/benchmark-report.md`

## Verification

```bash
bun test
bun run typecheck
# Then run benchmark scripts (exact commands depend on benchmark harness in place)
```

## Deliverables

- New: `.chief/milestone-8/_report/task-6/benchmark-report.md`
- New: `.chief/milestone-8/_report/task-6/` (raw data files)
