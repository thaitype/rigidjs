# Task 3: Light Vec Churn Column-Swap Optimization

## Objective

B2-vec is at 0.91x after M5's Map.get fix. The remaining gap is in the `swapRemove` column swap loop. Try loop unrolling or batching the column swap to close the gap toward >=1.0x.

**Low priority:** If tasks 1 and 2 consume the budget, this task can defer to M7.

## Scope

- **Included:** `swapRemove` inner loop optimization in `src/vec/vec.ts`
- **Excluded:** Changes to public API, changes to slab, new removal strategies

## Rules & Contracts to follow

- `.chief/_rules/_verification/verification.md` -- all changes must pass `bun test` and `bun run typecheck`
- `.chief/_rules/_standard/` -- coding standards

## Steps

1. **Read the current swapRemove** in `src/vec/vec.ts` (lines 377-391):
   ```typescript
   const lastIndex = _len - 1
   for (let c = 0; c < _columnArrays.length; c++) {
     const arr = _columnArrays[c]!
     arr[index] = arr[lastIndex]!
   }
   _len--
   ```
   This loops over `_columnArrays` (one per flattened field). For a Vec3 struct (x, y, z), that is 3 iterations. For a Particle (pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, life, id), that is 8 iterations.

2. **Write a profiling script** at `tmp/profile-swap-remove.ts` that:
   - Isolates the column swap cost at different column counts (3, 6, 8)
   - Compares: current loop vs unrolled (hardcoded for 3 columns) vs `TypedArray.copyWithin` approach
   - Measures per-call ns

3. **Run baseline benchmark:**
   ```
   bun run bench -s B2-vec
   ```

4. **Try optimization approaches:**
   a. **Loop unrolling at codegen time:** If the column count is known at vec construction, generate an unrolled swap function via `new Function()` that directly accesses `_columnArrays[0]`, `_columnArrays[1]`, etc. without loop overhead.
   b. **Batched swap via a single memcpy-style operation:** If columns are contiguous in the buffer (they are in SoA layout but at different offsets), a single `Uint8Array.copyWithin` on the raw buffer could swap all fields in one call -- but only if the fields are adjacent, which they are NOT in SoA layout. This approach likely does not apply.
   c. **Pre-extract and cache array refs as local variables** in swapRemove closure to avoid `_columnArrays[c]` indexing.

5. **If any approach shows >5% improvement**, implement it.

6. **Run verification:**
   ```
   bun test
   bun run typecheck
   bun run bench -s B2-vec
   ```

## Acceptance Criteria

- swapRemove is either:
  - Optimized with measurable improvement, tests pass, no regression at N=100k
  - OR documented as not viable with profiling evidence
- Findings written to `.chief/milestone-6/_report/task-3/findings.md`

## Verification

```bash
bun test
bun run typecheck
bun run bench -s B2-vec
```

## Deliverables

- `tmp/profile-swap-remove.ts` -- profiling script
- `.chief/milestone-6/_report/task-3/findings.md` -- results and decision
- Code changes (if applicable) to `src/vec/vec.ts`
