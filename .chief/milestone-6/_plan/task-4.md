# Task 4: Full Suite Re-run + Update Progress Report

## Objective

Re-run the entire benchmark suite with per-process isolation, update the progress report with new numbers reflecting any M6 optimizations, and write a brief M6 summary.

## Scope

- **Included:** Benchmark execution, report updates, gap analysis updates
- **Excluded:** Code changes, new benchmarks

## Rules & Contracts to follow

- `.chief/_rules/_verification/verification.md` -- tests and typecheck must still pass
- Benchmark methodology: per-process isolation (one scenario per `bun run` invocation)

## Steps

1. **Run full benchmark suite** with per-process isolation:
   ```
   bun run bench
   ```
   Or run each scenario individually if the harness does not support batch mode with isolation.

2. **Collect results** into `.chief/milestone-6/_report/task-4/results.json`.

3. **Update the gap analysis.** Create `.chief/milestone-6/_report/task-4/gap-analysis.md` with:
   - Updated ratio table reflecting M6 changes
   - Before/after comparison for any operations that changed
   - Updated classification of gaps (which moved closer to 1x, which stayed the same)

4. **Update the progress report.** Create `.chief/milestone-6/_report/final-progress-report.md` with:
   - Updated Section 1 (Best Tool for Each Workload) with new numbers
   - Updated Section 4 (Roadmap) adjusting M7+ based on M6 outcomes
   - Reference findings from tasks 1-3

5. **Write M6 summary** at `.chief/milestone-6/_report/milestone-summary.md`:
   - What was attempted in each task
   - What succeeded and what was deferred
   - Key findings
   - Recommendations for M7

## Acceptance Criteria

- Full benchmark suite executed with per-process isolation
- Results JSON saved
- Gap analysis updated with new numbers
- Progress report updated
- M6 summary written

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- `.chief/milestone-6/_report/task-4/results.json`
- `.chief/milestone-6/_report/task-4/gap-analysis.md`
- `.chief/milestone-6/_report/final-progress-report.md`
- `.chief/milestone-6/_report/milestone-summary.md`
