# Task 5 — Slot-Key Amendment

## Objective

Align `Slab<F>` with the Rust `slab` crate's numeric-key ergonomics: change `remove`/`has`/`get` to take a numeric slot, and expose `handle.slot` as a public read-only getter. This closes the handle-reuse footgun discovered at the end of task-4 without introducing any per-call allocation.

This task is a **contract amendment** for milestone-2. The updated contracts are already in place at:
- `.chief/_rules/_contract/public-api.md` (slab section)
- `.chief/milestone-2/_contract/public-api.md`
- `.chief/_rules/_goal/rigidjs-design-spec-v3.md` §4.2

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md` — still the law: no per-call alloc, no Proxy
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_contract/public-api.md` — updated slab section
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_contract/public-api.md` — updated `Slab<F>` / `Handle<F>`
7. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` §4.2 — updated example
8. Existing source:
   - `src/struct/handle-codegen.ts`
   - `src/slab/slab.ts`
   - `tests/struct/handle-slot.test.ts`
   - `tests/slab/slab.test.ts`
   - `tests/public-api/milestone-2.test.ts`
   - `examples/particles.ts`

## Deliverables

### 1. Handle codegen — add public `slot` getter

Modify `src/struct/handle-codegen.ts` so every generated class emits:

```js
get slot() { return this._slot }
```

Rules:
- Emit as a getter (not a raw data property) so it is read-only from user code.
- The getter body contains **only** `return this._slot` — no allocation, no conditional.
- Do NOT remove or rename `this._slot` — internal bookkeeping stays identical.
- Nested sub-handles still receive `slot=0` at construction. Their `slot` getter returns `0`. This is fine — nested handles are not user-facing container entries.
- The `_rebase(v, o, s)` signature stays the same.

### 2. `Slab<F>` signature change

Modify `src/slab/slab.ts`:

- Change `Slab<F>.remove` parameter from `handle: Handle<F>` to `slot: number`.
- Change `Slab<F>.has` parameter from `handle: Handle<F>` to `slot: number`.
- `Slab<F>.get(slot: number)` — already takes a number, unchanged.
- `Slab<F>.insert()` — unchanged, still returns `Handle<F>`.
- `remove(slot)` implementation:
  - Validate `slot` is an integer in `[0, capacity)`. Out-of-range throws `"slot X out of range"`.
  - If bit is already clear → throw `"slot X already free"` (double-free detection).
  - Clear the bitmap bit, push slot onto the free-list, decrement `len`.
- `has(slot)` implementation:
  - Validate `slot` is an integer in `[0, capacity)`. Out-of-range throws.
  - Return `bitmapGet(bits, slot) === 1`.
- Both methods still check `_dropped` and throw `"slab has been dropped"` first.
- Both methods must be allocation-free: no object creation, no string concat outside the error path (use template literals only when throwing).

### 3. Remove the old handle-based remove/has code paths

Delete any code that read `handle._slot` from inside `remove`/`has`. The new API takes the number directly. Any internal helper that wrapped the lookup can be inlined or removed.

### 4. Update tests

- `tests/slab/slab.test.ts`:
  - Update all call sites of `remove(handle)` → `remove(handleOrIndex)` where callers pass the slot index. The simplest pattern is `slab.remove(h.slot)` or `slab.remove(0)`.
  - Update all call sites of `has(handle)` → `has(slot)` similarly.
  - Add new tests:
    - `remove` with out-of-range slot (negative, `>= capacity`, NaN, non-integer) → throws
    - `has` with out-of-range slot → throws
    - `handle.slot` returns the current slot, updates after `get(i)` rebases it
    - `handle.slot` is a getter, not an assignable property (the setter should not exist)
  - Keep the footgun-proof test: after `const a = insert(); const b = insert()`, calling `remove(a.slot)` correctly removes slot 0 and calling `remove(b.slot)` removes slot 1 — though since the handle is shared, `a.slot === b.slot` after the second insert. The correct pattern is `const slotA = insert().slot; const slotB = insert().slot; remove(slotA)`.

- `tests/struct/handle-slot.test.ts`:
  - Add a test that `handle.slot` is observable (public getter) and returns the same value as the internal `_slot`.
  - Keep the existing test that `_slot` is a raw own-property, but add a check that `slot` is a getter on the prototype.

- `tests/public-api/milestone-2.test.ts`:
  - Update any references to handle-based `remove`/`has` signatures.
  - Add a type-level check that `slab.remove` accepts `number` and rejects `Handle<F>`.

### 5. Update the example

Rewrite `examples/particles.ts` to use the new idiom:

- Capture slot indices in a plain `number[]` (or skip capture entirely and use `slab.get(i)` + `slab.has(i)` during iteration, which is cleaner).
- The iteration loop becomes:
  ```ts
  for (let i = 0; i < particles.capacity; i++) {
    if (!particles.has(i)) continue
    const h = particles.get(i)
    h.pos.x += h.vel.x
  }
  ```
- The removal phase becomes:
  ```ts
  for (let i = 0; i < particles.capacity; i++) {
    if (!particles.has(i)) continue
    const h = particles.get(i)
    if (h.life <= 0) particles.remove(i)
  }
  ```
- Update the JSDoc comment at the top of the example to reflect the new invariant: "handles are shared; use `slot` indices for stable references".
- Output lines and final numbers should remain deterministic and readable.

### 6. Regenerate acceptance report

Update `.chief/milestone-2/_report/task-4/acceptance.md` OR append a new section noting the task-5 amendment. Prefer appending a short section titled "Task-5 amendment" with:
- Summary of the contract change
- `bun test` / `bun run typecheck` / example output after the change
- Confirmation that all milestone-2 success criteria still hold under the new signatures

## Acceptance Criteria

- [ ] `bun test` exits 0 with all prior-milestone tests plus new slot-key tests
- [ ] `bun run typecheck` exits 0
- [ ] `bun run examples/particles.ts` still prints a deterministic summary and exits 0
- [ ] `grep -n "get slot()" src/struct/handle-codegen.ts` — at least one match (the generated getter literal inside the codegen template)
- [ ] `grep -rn "remove(handle" src/slab/slab.ts` — zero matches
- [ ] `grep -rn "has(handle" src/slab/slab.ts` — zero matches
- [ ] `grep -rn "Proxy" src/` — zero matches
- [ ] `grep -n "new ArrayBuffer(" src/slab/slab.ts` — still exactly one match
- [ ] `grep -n "new DataView(" src/slab/slab.ts` — still exactly one match
- [ ] No new allocations inside `remove`, `has`, `get`, `insert` hot paths — verified by code review and by the existing "no per-call alloc" convention tests
- [ ] `handle.slot` getter is read-only (no setter emitted)
- [ ] A test demonstrates that `remove(slotA)` after a subsequent `insert()` removes the ORIGINALLY captured slot, not the handle's current position (the whole point of this amendment)
- [ ] `examples/particles.ts` JSDoc mentions handle reuse + slot capture
- [ ] Acceptance report updated or appended with task-5 amendment section

## Out of Scope

- Adding `slot` setter, slot branding, or `Entity`-style wrapper types — explicit no
- Changing `insert()`'s return type (still returns `Handle<F>`, not a number)
- Changing `get(slot)`'s signature (already takes a number)
- Changing `struct`, `StructDef`, `computeLayout`, or bitmap primitives
- `.iter()`, `for..of`, `.insert({...})` — still future
- Vec, bump, strings — still future

## Notes

- **Why `insert()` still returns `Handle<F>` not `number`:** the hot-loop pattern `const h = insert(); h.x = ...` is the most common use of `insert()` and must stay one-liner. Users who need the number just write `.slot`.
- **Why `get(slot)` takes a number:** already did in task-3 — no change.
- **Why `has` and `remove` changed:** to eliminate the stale-handle footgun. A `number` can't go stale.
- **Why not brand the `number`:** type-level branding is fine but adds complexity for little gain pre-1.0. Revisit if slot-mixing becomes a real bug in examples.
- **Why keep `_slot` internal:** the public getter `slot` is the contract; `_slot` remains the raw storage and may be renamed freely in the future.
- **Double-free detection:** already present in task-3. Just re-verify the error message matches `"slot X already free"` or equivalent.
- **Integer/range validation on `has(slot)`:** this is a change from task-3 (where `has` took a handle and never needed range check). New test required.
