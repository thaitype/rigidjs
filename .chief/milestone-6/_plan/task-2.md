# Task 2: Time-boxed forEach Stride Optimization

## Objective

Vec forEach is 0.85x JS due to callback dispatch (~3.3ns) + handle rebase (~10ns). Investigate whether a pre-computed offset stride can reduce rebase cost by advancing the handle via addition instead of per-element index assignment.

This task is **time-boxed**: if the stride approach does not yield measurable improvement after reasonable investigation, accept 0.85x and document findings.

## Scope

- **Included:** Handle codegen changes for stride-based rebase, profiling, forEach inner loop optimization
- **Excluded:** Changes to public API signatures, new iteration methods, for..of changes

## Rules & Contracts to follow

- `.chief/_rules/_verification/verification.md` -- all changes must pass `bun test` and `bun run typecheck`
- `.chief/_rules/_standard/` -- coding standards
- `.chief/_rules/_contract/` -- public API is append-only; do not change forEach signature

## Steps

1. **Read the current handle codegen** at `src/struct/handle-codegen.ts`. Focus on:
   - The `_rebase(s)` method: currently sets `this._slot = s` and recursively rebases sub-handles
   - The field accessor pattern: `get x() { return this._c_pos_x[this._slot] }`

2. **Understand the stride idea:**
   - Currently: each forEach iteration calls `_rebase(i)` which sets `this._slot = i`
   - Stride approach: instead of `_rebase(i)`, increment `this._slot++` (or `this._slot += 1`)
   - This eliminates the function call overhead of `_rebase` in the forEach path
   - For nested structs, sub-handles also need `_slot++` -- could be inlined

3. **Write a profiling script** at `tmp/profile-forEach-stride.ts` that:
   - Compares current forEach (with `_rebase(i)`) vs a manually patched version using slot increment
   - Measures per-element ns for both approaches at N=100k
   - Tests whether JSC optimizes `_slot++` better than `_rebase(i)` function call

4. **Run baseline benchmarks:**
   ```
   bun run bench -s B3-slab-forEach
   bun run bench -s B3-vec-forEach
   ```

5. **If stride shows promise**, implement it:
   - Add a `_advance()` method to the generated handle class: `_advance() { this._slot++ }` (and recurse for sub-handles)
   - Modify `vec.forEach` to call `_rebase(0)` once before the loop, then `_advance()` per iteration
   - Modify `slab.forEach` similarly (but must skip holes -- stride only works for occupied slots, so this may not apply to slab)

6. **If stride does NOT show promise** (< 5% improvement):
   - Document why in findings
   - Accept 0.85x as the current floor for callback-based iteration
   - Note that column access (2.42x) and get(i) (1.72x) are the recommended fast paths

7. **Run verification:**
   ```
   bun test
   bun run typecheck
   bun run bench -s B3-slab-forEach
   bun run bench -s B3-vec-forEach
   ```

## Acceptance Criteria

- Stride optimization is either:
  - Implemented with measurable improvement (>5% on vec forEach), tests pass, no regression
  - OR documented as not viable with profiling evidence
- Findings written to `.chief/milestone-6/_report/task-2/findings.md`

## Verification

```bash
bun test
bun run typecheck
bun run bench -s B3-slab-forEach
bun run bench -s B3-vec-forEach
```

## Deliverables

- `tmp/profile-forEach-stride.ts` -- profiling script
- `.chief/milestone-6/_report/task-2/findings.md` -- results and decision
- Code changes (if applicable) to `src/struct/handle-codegen.ts`, `src/vec/vec.ts`, `src/slab/slab.ts`
