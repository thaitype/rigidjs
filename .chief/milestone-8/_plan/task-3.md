# Task 3: RigidError Class + Migrate All Throws in Vec and Slab

## Objective

Create a `RigidError` class with a `.code` property for structured error identification. Replace ALL `Error`/`RangeError`/`TypeError` throws in `src/vec/vec.ts` and `src/slab/slab.ts` with `RigidError`. Add `assertLive` and bounds checks back to JS mode vec methods for consistency between modes.

## Scope

**Included:**
- Create `src/error.ts` with `RigidError` class
- Export `RigidError` from `src/index.ts`
- Define error codes: `DROPPED`, `OUT_OF_BOUNDS`, `EMPTY`, `AT_CAPACITY`, `INVALID_ARGUMENT`, `ALIGNMENT_ERROR`, `UNKNOWN_COLUMN`
- Replace all throws in `src/vec/vec.ts` (both JS and SoA methods)
- Replace all throws in `src/slab/slab.ts`
- Add `assertLive` to JS mode methods: `_pushJS`, `_popJS`, `_getJS`, `_swapRemoveJS`, `_removeJS`, `_forEachJS`, `_iteratorJS`
- Add bounds checks to JS mode: `_getJS`, `_swapRemoveJS`, `_removeJS`
- Tests for RigidError: instanceof check, `.code` property, `.message` property
- Update existing tests that check error messages (if any use exact string matching)

**Excluded:**
- Mutation guard (task-4, depends on this task)
- Performance measurement of added checks (task-6)
- Changes to struct module errors (out of scope for M8)

## Rules & Contracts to Follow

- `.chief/_rules/_verification/verification.md`
- `.chief/_rules/_standard/`
- `CLAUDE.md`: no runtime dependencies, strict TS, named exports only

## Steps

1. Create `src/error.ts`:
   ```ts
   export type RigidErrorCode =
     | 'DROPPED'
     | 'OUT_OF_BOUNDS'
     | 'EMPTY'
     | 'AT_CAPACITY'
     | 'INVALID_ARGUMENT'
     | 'ALIGNMENT_ERROR'
     | 'UNKNOWN_COLUMN'

   export class RigidError extends Error {
     readonly code: RigidErrorCode
     constructor(code: RigidErrorCode, message: string) {
       super(message)
       this.code = code
       this.name = 'RigidError'
     }
   }
   ```

2. Export `RigidError` and `RigidErrorCode` from `src/index.ts`.

3. In `src/vec/vec.ts`:
   - Import `RigidError`
   - Replace all `throw new Error(...)` with `throw new RigidError(code, message)`
   - Add `this._assertLive()` to all JS mode methods
   - Add bounds checks to `_getJS`, `_swapRemoveJS`, `_removeJS`:
     ```ts
     if (index < 0 || index >= this._len) throw new RigidError('OUT_OF_BOUNDS', 'index out of range')
     ```
   - Ensure error messages are the same between JS and SoA modes for the same operation

4. In `src/slab/slab.ts`:
   - Import `RigidError`
   - Replace all `throw new Error(...)` with `throw new RigidError(code, message)`

5. Write tests in `tests/error.test.ts`:
   - `RigidError` is instanceof `Error`
   - `.code` matches expected value
   - `.name` is `'RigidError'`
   - Vec: use-after-drop throws with code `DROPPED`
   - Vec: out-of-bounds get throws with code `OUT_OF_BOUNDS`
   - Vec: pop on empty throws with code `EMPTY`
   - Slab: use-after-drop throws with code `DROPPED`
   - Slab: at capacity throws with code `AT_CAPACITY`
   - JS mode vec: same errors as SoA mode (assertLive, bounds checks)

6. Update any existing tests that match exact error message strings.

## Acceptance Criteria

- [ ] `RigidError` class exists in `src/error.ts` and is exported from `src/index.ts`
- [ ] Every `throw` in `src/vec/vec.ts` uses `RigidError`
- [ ] Every `throw` in `src/slab/slab.ts` uses `RigidError`
- [ ] JS mode vec methods have `assertLive` and bounds checks
- [ ] Error messages are consistent between JS and SoA modes
- [ ] New tests cover RigidError code property for key error scenarios
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- New: `src/error.ts`
- Modified: `src/index.ts`, `src/vec/vec.ts`, `src/slab/slab.ts`
- New: `tests/error.test.ts`
