# Task 1: Investigate vec get(i) Collapse at N=100-1000

## Objective

At N=100, `vec.get(i)` iteration drops to 0.20x JS (vs 1.72x at N=100k). Column access at N=100 is fine (1.10x), so the problem is specific to the handle/get path. Root-cause this anomaly and fix it if possible.

## Scope

- **Included:** Profiling, investigation, codegen analysis, fix if root cause is addressable
- **Excluded:** Changes to public API, new container types, changes unrelated to get(i) performance

## Rules & Contracts to follow

- `.chief/_rules/_verification/verification.md` -- all changes must pass `bun test` and `bun run typecheck`
- `.chief/_rules/_standard/` -- coding standards
- `.chief/_rules/_goal/performance-vision.md` -- >=1x target for all operations

## Steps

1. **Read the current handle codegen** at `src/struct/handle-codegen.ts`. Understand how `_rebase(s)` works and what the generated `get` accessor does (`this._c_pos_x[this._slot]`).

2. **Read the benchmark scenario** at `benchmark/scenarios/b3-small-scale.ts` and `benchmark/scenarios/b3-vec-get.ts` to understand what is being measured.

3. **Write a profiling script** at `tmp/profile-get-collapse.ts` that:
   - Creates a vec with N=10, 100, 1000, 10000, 100000 elements
   - Runs a tight `for (let i = 0; i < len; i++) { v.get(i).x += v.get(i).y }` loop
   - Measures per-element ns at each N
   - Compares to equivalent JS baseline at each N
   - Tests specific hypotheses:
     a. Is it JIT tier transition? (JSC has 3 tiers: LLInt, Baseline, DFG, FTL. Small loops may stay in Baseline.)
     b. Is it megamorphic dispatch? (Handle object shape may differ at small N.)
     c. Is it `_rebase` cost dominating at small N? (Constant per-call overhead not amortized.)
     d. Is it a measurement artifact? (Benchmark harness overhead at small N.)

4. **Run baseline benchmarks:**
   ```
   bun run bench -s B3-small-scale
   ```

5. **Analyze results** and determine root cause category:
   - **If codegen issue:** Fix the handle generation and re-measure
   - **If JIT tier artifact:** Document the JIT behavior, note the crossover point, and adjust recommendations in the progress report
   - **If measurement artifact:** Fix the benchmark methodology

6. **If a fix is implemented**, run:
   ```
   bun run bench -s B3-small-scale
   bun run bench -s B3-vec-get
   ```
   Verify no regression at N=100k.

7. **Run verification:**
   ```
   bun test
   bun run typecheck
   ```

## Acceptance Criteria

- Root cause is identified with evidence (profiling data, JIT analysis)
- If fixable: fix is implemented, tests pass, no regression at N=100k
- If JIT artifact: documented with profiling evidence in report
- Findings written to `.chief/milestone-6/_report/task-1/findings.md`

## Verification

```bash
bun test
bun run typecheck
bun run bench -s B3-small-scale
bun run bench -s B3-vec-get
```

## Deliverables

- `tmp/profile-get-collapse.ts` -- profiling script
- `.chief/milestone-6/_report/task-1/findings.md` -- root cause analysis
- Code changes (if applicable) to `src/struct/handle-codegen.ts` or `src/vec/vec.ts`
