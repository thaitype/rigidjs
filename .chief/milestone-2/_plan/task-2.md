# Task 2 — Internal Bitmap + Free-List Primitives

## Objective
Create a tiny internal bitmap module under `src/slab/` that provides allocation-free `set(i)`, `clear(i)`, and `get(i)` operations over a `Uint8Array`. This is the occupancy-tracking primitive used by `slab()` in task 3. Not exported from `src/index.ts`.

## Inputs (read before starting)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md` (allocation budget: zero per-call allocation)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md` (directory layout rules: new `src/slab/` subdir is approved by goal file)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_goal/goal.md` (§"Non-Negotiables": bit `i` of byte `i >> 3`)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` §6.2

## Deliverables
- `/Users/thada/gits/thaitype/rigidjs/src/slab/bitmap.ts`
  - Exports three pure functions:
    ```ts
    export function bitmapSet(bytes: Uint8Array, index: number): void
    export function bitmapClear(bytes: Uint8Array, index: number): void
    export function bitmapGet(bytes: Uint8Array, index: number): boolean
    ```
  - Convention (documented in a top-of-file comment as the single source of truth):
    - Byte index = `index >> 3`
    - Bit mask = `1 << (index & 7)`
    - Occupied iff `(bytes[byteIdx] & mask) !== 0`
  - `bitmapSet` ORs the mask in; `bitmapClear` ANDs the complement; `bitmapGet` returns a boolean.
  - All three functions must be allocation-free: no temporaries, no array literals, no destructuring.
  - Internal — NOT re-exported from `src/index.ts`.
  - Also exports a tiny helper:
    ```ts
    export function bitmapByteLength(capacity: number): number
    ```
    returning `Math.ceil(capacity / 8)`. This keeps the size formula in one place so `slab()` and tests agree.
- `/Users/thada/gits/thaitype/rigidjs/tests/slab/bitmap.test.ts`
  - Round-trip: `set(i)` → `get(i) === true`; `clear(i)` → `get(i) === false`.
  - Independence: setting bit 3 does not affect bits 0, 1, 2, 4.
  - Byte-boundary crossings: bit 7 lives in byte 0, bit 8 lives in byte 1, bit 15 in byte 1, bit 16 in byte 2.
  - Initial state: a freshly-created `Uint8Array` reports `get(i) === false` for all valid `i`.
  - `bitmapByteLength(0) === 0`, `bitmapByteLength(1) === 1`, `bitmapByteLength(8) === 1`, `bitmapByteLength(9) === 2`, `bitmapByteLength(100) === 13`.
  - Capacity 1000: spot-check bits 0, 1, 500, 999.
- `/Users/thada/gits/thaitype/rigidjs/src/slab/free-list.ts` (optional split — planner's call)
  - If the task-3 author prefers to keep the free-list logic inline in `slab.ts`, this file is NOT required. Default: **do not create it in this task**. The free-list is a plain JS array with `push`/`pop`; it needs no dedicated module.

## Acceptance criteria
- [ ] `bun test` passes, including every bitmap test
- [ ] `bun run typecheck` exits 0
- [ ] `grep -n "bitmapSet\|bitmapClear\|bitmapGet" src/index.ts` returns zero matches (not public)
- [ ] `grep -n "new " src/slab/bitmap.ts` returns zero matches in function bodies (no per-call allocation; the helper module itself does not construct anything)
- [ ] File is under 80 lines of source
- [ ] All three functions have JSDoc with the bit-layout convention

## Out of scope
- The `slab()` function itself (task 3)
- Free-list as a separate module (deferred / inlined in `slab.ts`)
- Any iteration over the bitmap (e.g., "find first set bit") — not needed; occupancy lookup is always by index

## Notes
- The bitmap layout comment at the top of `bitmap.ts` is the **single source of truth** for the convention. `slab.ts` in task 3 must import these helpers rather than inline its own bit math.
- These functions are called on hot paths (`slab.has`, `slab.insert`, `slab.remove`). Keep the function bodies as literal as possible to encourage inlining by JSC — no tuple returns, no object returns, no `switch`.
- `Uint8Array` index reads through `noUncheckedIndexedAccess` may yield `number | undefined`. Coerce defensively with `(bytes[byteIdx] ?? 0)` for reads, or use `!` after guarding — choose whichever keeps strict typecheck green without extra runtime cost.
