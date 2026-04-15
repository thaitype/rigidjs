# Task 2: forEach(cb) for Vec and Slab + vec.reserve(n)

## Objective

Ship `vec.forEach(cb)`, `slab.forEach(cb)`, and `vec.reserve(n)` as new public API methods. `forEach` provides internal iteration without iterator protocol overhead. `reserve` allows pre-growing vec capacity to avoid repeated 2x doublings.

## Scope

**Included:**
- `vec.forEach(cb: (handle: Handle<F>, index: number) => void): void` -- iterates indices 0..len-1, rebasing the shared handle and calling cb for each.
- `slab.forEach(cb: (handle: Handle<F>, slot: number) => void): void` -- iterates all occupied slots (skipping holes via bitmap), rebasing the shared handle and calling cb for each.
- `vec.reserve(n: number): void` -- if current capacity < n, grow to at least n. Same growth logic as push overflow but triggered explicitly. No entities are pushed.
- Unit tests for all three methods.
- B3-vec-forEach and B3-slab-forEach benchmark scenarios under `benchmark/scenarios/`.
- Update `src/index.ts` types if needed (Vec and Slab interfaces).

**Excluded:**
- No `thisArg` parameter on forEach (keep it simple, users can use arrow functions).
- No early-exit / break support (same as Array.forEach).
- No changes to existing iteration APIs (for..of on vec remains as-is).
- No changes to benchmark harness infrastructure (task-1 handles that).

## Rules & Contracts to Follow

- `.chief/_rules/_contract/public-api.md` -- append-only within milestone.
- `.chief/_rules/_standard/memory-and-perf.md` -- no per-call allocation in forEach hot path. forEach must reuse the shared handle.
- `.chief/_rules/_standard/typescript.md` -- explicit return types on exported functions, no `any` in public API.
- `.chief/_rules/_verification/verification.md` -- bun test + typecheck must pass.

## Steps

1. Add `forEach` method to `Vec` interface and implementation in `src/vec/vec.ts`. Implementation: plain `for (let i = 0; i < this._len; i++)` loop, rebase handle to index `i`, call `cb(handle, i)`.
2. Add `forEach` method to `Slab` interface and implementation in `src/slab/slab.ts`. Implementation: `for (let i = 0; i < this._capacity; i++)`, check occupancy bitmap, if occupied: rebase handle, call `cb(handle, i)`.
3. Add `reserve` method to `Vec` interface and implementation. If `n > capacity`, trigger the same growth logic used by push (allocate new buffer, copy columns via TypedArray.set, update refs). If `n <= capacity`, no-op.
4. Write unit tests in `tests/vec.test.ts` and `tests/slab.test.ts`:
   - forEach visits all elements in order (vec) / all occupied slots (slab).
   - forEach skips removed slots (slab).
   - forEach receives correct index/slot numbers.
   - forEach with empty container calls cb zero times.
   - forEach after drop throws.
   - reserve grows capacity without changing len.
   - reserve with n <= capacity is a no-op.
   - reserve invalidates old column refs (same as push growth).
   - B1-vec with reserve() has allocationDelta <= 500.
5. Add `benchmark/scenarios/b3-vec-forEach.ts` -- same workload as B3-vec-handle but using `vec.forEach()`.
6. Add `benchmark/scenarios/b3-slab-forEach.ts` -- same workload as B3-iterate-mutate but using `slab.forEach()`.

## Acceptance Criteria

- [ ] `vec.forEach(cb)` iterates all elements, reusing shared handle, zero per-call allocations.
- [ ] `slab.forEach(cb)` iterates all occupied slots, skipping holes, reusing shared handle.
- [ ] `vec.reserve(n)` grows capacity to at least n without pushing entities.
- [ ] All new methods have unit tests.
- [ ] B3-vec-forEach and B3-slab-forEach benchmark scenarios exist and run.
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- Modified `src/vec/vec.ts` (forEach, reserve)
- Modified `src/slab/slab.ts` (forEach)
- Updated type interfaces (Vec, Slab) if needed
- New/updated tests in `tests/vec.test.ts` and `tests/slab.test.ts`
- New `benchmark/scenarios/b3-vec-forEach.ts`
- New `benchmark/scenarios/b3-slab-forEach.ts`
