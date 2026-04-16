# Task 4: Mutation Guard for Vec and Slab Iteration

## Objective

Add an `_iterating` flag to both vec and slab that prevents mutation during `forEach` and `for..of` iteration. Mutating methods throw `RigidError` with code `MUTATION_DURING_ITERATION`.

**Depends on:** Task 3 (RigidError class must exist).

## Scope

**Included:**
- Add `_iterating` boolean flag to VecImpl class
- Add `_iterating` boolean flag to slab closure state
- Set flag in `forEach` and `for..of` (use try/finally to ensure cleanup)
- Check flag in mutating methods: `push`, `pop`, `swapRemove`, `remove`, `clear`, `drop`
- Both JS and SoA modes in vec
- Tests for mutation-during-iteration detection

**Excluded:**
- `insert` in slab (already covered -- slab's `insert` is a mutating method)
- Nested iteration detection (iterating while already iterating is allowed -- only mutation is blocked)
- Async iteration patterns

## Rules & Contracts to Follow

- `.chief/_rules/_verification/verification.md`
- `.chief/_rules/_standard/`
- `CLAUDE.md`: no hidden allocations in hot paths (the boolean check is a single branch, acceptable)

## Steps

1. In `src/vec/vec.ts` (VecImpl class):
   - Add `private _iterating = false`
   - In `_forEachJS` and `_forEachSoA`: wrap the loop body in `this._iterating = true; try { ... } finally { this._iterating = false; }`
   - In `_iteratorJS` and `_iteratorSoA`: set `_iterating = true` on first `next()` call (or in the iterator factory), clear in `finally` when done (return `{ done: true }`)
   - In `_pushJS`, `_pushSoA`, `_popJS`, `_popSoA`, `_swapRemoveJS`, `_swapRemoveSoA`, `_removeJS`, `_removeSoA`, `clear`, `drop`: add at the top:
     ```ts
     if (this._iterating) throw new RigidError('MUTATION_DURING_ITERATION', 'cannot mutate vec during iteration')
     ```

2. In `src/slab/slab.ts`:
   - Add `let _iterating = false` in the closure
   - In `forEach`: wrap in try/finally
   - In `insert`, `remove`, `clear`, `drop`: check `_iterating`

3. Add `MUTATION_DURING_ITERATION` to `RigidErrorCode` in `src/error.ts`.

4. Write tests in `tests/mutation-guard.test.ts`:
   - Vec: push during forEach throws `MUTATION_DURING_ITERATION`
   - Vec: pop during forEach throws
   - Vec: swapRemove during forEach throws
   - Vec: remove during forEach throws
   - Vec: clear during forEach throws
   - Vec: drop during forEach throws
   - Vec: push during for..of throws
   - Vec JS mode: same behavior as SoA mode
   - Slab: insert during forEach throws
   - Slab: remove during forEach throws
   - Slab: clear during forEach throws
   - Slab: nested forEach (read-only) is allowed
   - Vec/Slab: flag is cleared after forEach completes (mutation works again)
   - Vec/Slab: flag is cleared after forEach throws (try/finally)

## Acceptance Criteria

- [ ] `_iterating` flag exists in VecImpl and slab
- [ ] `forEach` and `for..of` set/clear the flag with try/finally
- [ ] All mutating methods check the flag and throw `RigidError` with `MUTATION_DURING_ITERATION`
- [ ] Both JS and SoA modes in vec are guarded
- [ ] Flag is properly cleared even when the callback throws
- [ ] Tests cover all mutating methods during iteration
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- Modified: `src/vec/vec.ts`, `src/slab/slab.ts`, `src/error.ts`
- New: `tests/mutation-guard.test.ts`
