# Task 1 — Handle Codegen Extension: Slot-Stamped Handles

## Objective
Extend the existing `generateHandleClass` code generator so every generated handle carries an internal `_slot` numeric field. The field is set in the constructor and updated by `_rebase`, enabling `slab.remove(handle)` to read the slot without any per-call allocation. Must be a surgical, non-breaking change: all 55 existing milestone-1 tests still pass.

## Inputs (read before starting)
- `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md` (allocation budget, no closures in hot paths)
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_goal/goal.md` (§2 "Slot-stamped handles")
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_contract/public-api.md` (Handle Reuse Contract)
- `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts`
- `/Users/thada/gits/thaitype/rigidjs/src/internal/single-slot.ts`
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/handle-flat.test.ts`
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/handle-nested.test.ts`

## Deliverables
- `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts`
  - Update `HandleConstructor` signature to `new (view: DataView, baseOffset: number, slot: number): object`.
  - Generated constructor body stores `this._slot = s` (where `s` is the third parameter).
  - Generated `_rebase(view, baseOffset, slot)` updates `this._slot = s` in addition to `_v`/`_o`, and continues to rebase sub-handles. Sub-handles are rebased with their parent's new offset but **do not** need their own `_slot` (only the top-level handle returned to the user has meaningful slot semantics). Pass `0` for the sub-handle slot argument to keep the constructor signature uniform across nesting levels.
  - Internal `_slot` must not be exposed as a getter. It lives only as a raw instance property. Document in a comment that tests may access it via `(h as any)._slot`.
  - All DataView calls remain little-endian (`true`).
  - `new Function()` remains the only code generation mechanism — no closures in accessors.
- `/Users/thada/gits/thaitype/rigidjs/src/internal/single-slot.ts`
  - Update the `new (def._Handle as any)(view, 0)` call site to pass `0` as the slot argument.
  - No signature or export change.
- `/Users/thada/gits/thaitype/rigidjs/src/struct/struct.ts`
  - If the `StructDef._Handle` type in `src/types.ts` encodes the constructor signature, update the type there to match the new 3-arg form. Otherwise no change.
- `/Users/thada/gits/thaitype/rigidjs/src/types.ts`
  - Update the `_Handle` constructor type to `new (view: DataView, baseOffset: number, slot: number) => object`.
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/handle-flat.test.ts` & `handle-nested.test.ts`
  - Only modify if typecheck breaks because of the signature change. Prefer fixing via the test helper in `single-slot.ts` so these tests remain untouched.
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/handle-slot.test.ts` (new)
  - A small focused test that constructs a handle via `new def._Handle(view, 0, 7)` and asserts `(h as any)._slot === 7`.
  - A test that calls `(h as any)._rebase(view, 16, 9)` and asserts `(h as any)._slot === 9` and field reads now resolve at the new offset.

## Acceptance criteria
- [ ] `bun test` passes — all 55 existing milestone-1 tests still green plus the new `handle-slot.test.ts`
- [ ] `bun run typecheck` exits 0
- [ ] `grep -n "Proxy" src/` returns zero matches
- [ ] `grep -n "new Function" src/struct/handle-codegen.ts` still returns at least one match
- [ ] Generated constructor takes exactly 3 arguments `(v, o, s)` — verify by reading the source string emitted or by unit test
- [ ] `_slot` is NOT accessible via a getter — `Object.keys(h)` may contain `_slot` but no `get _slot()` is generated (reviewer check of the generated source string)
- [ ] `src/index.ts` is unchanged (no new public exports in this task)
- [ ] Nested sub-handles receive `slot=0` on construction and on `_rebase`; verify via a test that reads `(h.pos as any)._slot === 0`

## Out of scope
- `slab()` implementation (task 3)
- Bitmap / free-list (task 2)
- Public re-export of `Handle<F>` from `src/index.ts` (task 4)
- Any change to how field offsets are computed

## Notes
- The design decision is that `_slot` is a **raw instance property** on the generated handle, not a getter. Storing it as `this._slot = s` in the constructor body makes it a monomorphic own-property — JSC keeps this on the hidden class and access remains allocation-free.
- Keep the generated-source template minimal. The constructor body should now read roughly:
  ```js
  this._v=v;this._o=o;this._slot=s;
  this._sub_pos=new _C_pos(v,o+0,0);
  ```
  Note the trailing `,0` for nested sub-handles.
- `_rebase` body should read roughly:
  ```js
  this._v=v;this._o=o;this._slot=s;
  this._sub_pos._rebase(v,o+0,0);
  return this;
  ```
- The `_slot` field is internal: the milestone-2 contract says it is NOT a public property. Do not add JSDoc marking it `@public`. A leading underscore and the word "internal" in a comment is sufficient.
- If `src/types.ts` has `_Handle?: new (view: DataView, baseOffset: number) => object`, update it to the 3-arg form. This is an internal/implementation-detail type per the existing comment, so the change is non-breaking for public consumers.
- Do NOT touch `src/index.ts`. Do NOT touch `.chief/_rules`, `_contract`, or `_goal`.
