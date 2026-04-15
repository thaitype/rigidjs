# Task 1: Mode Dispatch Overhead Proof-of-Concept

**Status:** Not started
**Type:** Investigation / GATE
**Estimated effort:** 30-45 minutes
**Depends on:** Nothing
**Blocks:** Tasks 2-5

## Objective

Prove that adding a boolean mode-dispatch branch (`if (this._mode === 'soa')`) to every vec hot-path method does NOT regress large-scale SoA performance by more than 2%. If it does, we must redesign the dispatch strategy before continuing.

## Rationale

The hybrid vec will add an `if (_mode === 'soa')` check to every public method (push, get, forEach, pop, swapRemove, remove, column). After JIT warmup with a stable mode value, branch prediction should make this effectively free. But we must prove it empirically before building the full feature.

## Scope

**In scope:**
- Add a `_mode` variable (string, `'soa'`) to `src/vec/vec.ts`
- Add a dummy `if (_mode === 'soa') { ... } else { throw ... }` branch to: `push()`, `get()`, `forEach()`, `swapRemove()`, `remove()`, `pop()`, `[Symbol.iterator]`
- The else branch should `throw new Error('unreachable')` -- it will never execute during benchmarks
- Run the existing large-scale benchmarks: B2-vec, B3-vec-get, B3-vec-forEach, B3-vec-column, B8-vec-sustained
- Record before/after numbers
- Write a report with pass/fail determination

**Out of scope:**
- Any JS mode implementation
- Any API changes
- Any new tests (the existing tests must continue to pass)

## Rules & Contracts

- `.chief/_rules/_verification/verification.md` -- `bun test` and `bun run typecheck` must pass
- `.chief/_rules/_standard/` -- no new dependencies, no `any` in public API
- Do NOT change the public `Vec` interface type

## Steps

1. Create a branch or work on main (builder discretion)
2. In `src/vec/vec.ts`, add `let _mode: 'soa' | 'js' = 'soa'` near the top of the `vec()` closure
3. Wrap the body of each hot-path method in `if (_mode === 'soa') { <existing body> } else { throw new Error('not implemented: js mode') }`
4. Run `bun test` -- all existing tests must pass (the mode is always 'soa')
5. Run `bun run typecheck` -- must pass
6. Run benchmarks (each in separate process for JIT isolation):
   ```bash
   bun run benchmark/run-scenario.ts -s b2-vec-churn
   bun run benchmark/run-scenario.ts -s b3-vec-get
   bun run benchmark/run-scenario.ts -s b3-vec-forEach
   bun run benchmark/run-scenario.ts -s b3-vec-column
   bun run benchmark/run-scenario.ts -s b8-vec-sustained
   ```
7. Compare against M6 baseline numbers from `.chief/milestone-6/_report/task-4/gap-analysis.md`
8. Write report to `.chief/milestone-7/_report/task-1/dispatch-overhead.md`

## Acceptance Criteria

- [ ] `bun test` passes with zero failures
- [ ] `bun run typecheck` passes with zero errors
- [ ] All five benchmark scenarios run successfully
- [ ] Report documents before/after ratios for each scenario
- [ ] **GATE DECISION:** If ANY scenario regresses more than 2% (ratio drops by more than 0.02x), the report must state FAIL and propose an alternative dispatch strategy
- [ ] If all scenarios are within 2%, the report states PASS

## Verification

```bash
bun test
bun run typecheck
```

Benchmark commands listed in Steps above.

## Deliverables

- Modified `src/vec/vec.ts` with mode dispatch branches
- `.chief/milestone-7/_report/task-1/dispatch-overhead.md` with benchmark results and PASS/FAIL determination

## GATE Logic

- **PASS (regression <= 2%):** Proceed to Task 2 with the mode dispatch pattern
- **FAIL (regression > 2%):** Stop. Report must include at least one alternative strategy (e.g., separate VecJS and VecSoA classes, prototype swapping, etc.). Chief-agent will decide next steps before Task 2 begins.
