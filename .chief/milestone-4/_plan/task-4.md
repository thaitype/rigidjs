# Task 4 -- Slab Free-List Optimization

## Objective

Replace the JS `Array` free-list in `src/slab/slab.ts` with a pre-allocated `Uint32Array` stack and a stack pointer. This eliminates `Array.push()` / `Array.pop()` GC overhead during insert/remove churn. The change is internal-only -- the slab public API is unchanged. Expected improvement: B2 slab churn from 0.69x to ~0.80x JS.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_goal/goal.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_contract/public-api.md` -- slab API unchanged
7. Current source:
   - `/Users/thada/gits/thaitype/rigidjs/src/slab/slab.ts` -- the file to edit
   - `/Users/thada/gits/thaitype/rigidjs/src/slab/bitmap.ts` -- unchanged

## Scope Guardrails

- **Edits to:** `src/slab/slab.ts` only. No other source files.
- **Do NOT edit** `src/vec/**`, `src/struct/**`, `src/types.ts`, `src/index.ts`, `benchmark/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, `package.json`, `tsconfig.json`.
- **Do NOT modify any test file.** All existing slab tests must pass unchanged -- this is a strict internal refactor.
- **No new runtime dependencies.**
- **No `/tmp` scripts.**

## Deliverables

### 1. Replace free-list implementation in `src/slab/slab.ts`

Current state: the slab uses a JS `Array<number>` for the free-list, calling `Array.push(slot)` on remove and `Array.pop()` on insert.

New state: pre-allocate a `Uint32Array(capacity)` at slab construction. Maintain a stack pointer `_freeTop` (initialized to `capacity` -- all slots start free). On construction, fill the Uint32Array with slot indices `[0, 1, 2, ..., capacity-1]` (or `[capacity-1, ..., 1, 0]` if the pop order matters for allocation order -- match the current behavior so tests pass).

**insert():** `const slot = freeList[--_freeTop]`. This is a single indexed read + decrement. No `Array.pop()`.

**remove(slot):** `freeList[_freeTop++] = slot`. This is a single indexed write + increment. No `Array.push()`.

**clear():** Reset `_freeTop` and refill the Uint32Array (or just reset the pointer if the array was filled in a way that makes reset trivial).

Preserve the existing allocation order: currently, the free-list is initialized so that `insert()` returns slots in ascending order (0, 1, 2, ...) for a fresh slab. Verify this matches the current JS Array behavior and replicate it.

### 2. Verify all existing slab tests pass

Run the full test suite. Every slab test must pass without modification. The free-list is an internal detail -- no test should observe the difference.

If any test breaks, it means the test was relying on internal free-list implementation details. Identify and fix the test (but this should not happen -- the free-list order is preserved).

## Acceptance Criteria

- [ ] `bun test` exits 0 with zero failing tests. Test count unchanged (no new tests needed -- this is a pure internal refactor).
- [ ] `bun run typecheck` exits 0.
- [ ] `src/slab/slab.ts` no longer uses a JS `Array` for the free-list. Grep confirms no `Array`-based free-list pattern.
- [ ] `src/slab/slab.ts` uses a `Uint32Array` for the free-list with a stack pointer.
- [ ] `bun run examples/particles.ts` produces unchanged output.
- [ ] No other source files modified. `git diff src/vec/ src/struct/ src/types.ts src/index.ts` is empty.
- [ ] `benchmark/**` unchanged.
- [ ] No new runtime dependencies.
- [ ] No `/tmp` scripts.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-4/_plan/_todo.md`**.

## Out of Scope

- Benchmarks (task-5 re-runs slab benchmarks to measure the improvement).
- Any vec changes.
- Any struct changes.
- Adding new tests (the existing 263+ tests are the verification).
- Inlining bitmap ops (deferred optimization, not in scope).

## Notes

- The `Uint32Array` free-list is allocated once at slab construction alongside the main ArrayBuffer. It is a separate small allocation (4 bytes * capacity). At 100k capacity, that is 400KB -- negligible compared to the main buffer.
- The key GC benefit: `Uint32Array.push/pop` equivalent (indexed write + pointer increment) does not trigger JS Array internal reallocation or GC tracking. The `Uint32Array` is a single fixed-size allocation tracked as one GC object, vs a JS Array that may be backed by a resizable internal storage that the GC tracks separately.
- This optimization was identified in `.chief/milestone-3/_report/improvement-suggestions.md` (Option B) with expected impact: B2 churn from 0.69x to ~0.80x JS.
- The `drop()` method should null out the free-list Uint32Array alongside the main buffer.
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes.
