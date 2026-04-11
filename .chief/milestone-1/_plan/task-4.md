# Task 4 — Nested Struct Handle Support (Sub-Handle Reuse, Offset Rebasing)

## Objective
Extend `handle-codegen.ts` to support nested `StructDef` fields. Nested fields must return a pre-constructed sub-handle whose base offset is rebased relative to the parent's base — with zero allocation per access. Dotted access (`p.pos.x`) must round-trip through the underlying `DataView`.

## Inputs (read before starting)
- All prior tasks' deliverables
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md` (allocation budget — handle method / field access = 0 allocations)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` §4.1 (Particle example) and §6.1 (handle design)
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-1/_contract/public-api.md` (handle behavior guarantee 4: sub-handle is reused, base rebased)

## Deliverables
- Modified `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts`:
  - Removes the task-3 "nested not supported" guard.
  - For each nested struct field, the generated handle class:
    - At construction time, allocates ONE sub-handle instance pointing at `view` with base offset `this._o + <nestedOffset>`.
    - Stores it on the instance (e.g., `this._sub_<fieldName>`).
    - Exposes a getter `get fieldName()` that returns the stored sub-handle reference — no `new` inside the getter.
    - When the parent handle is later repointed (rebasing for container reuse — see Rebasing below), every sub-handle is also rebased.
  - Exposes a non-public `_rebase(view: DataView, baseOffset: number)` method on every generated handle class that:
    - Updates `this._v` and `this._o`
    - Recursively rebases each sub-handle by computing `baseOffset + <nestedFieldOffset>` and updating the sub-handle's `_v`/`_o`
    - Returns `this`
  - `_rebase` is internal; used by future container code (slab/vec) and by tests to verify rebasing works.
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/handle-nested.test.ts`:
  - Particle from spec §4.1: `const Vec3 = struct({ x:'f64', y:'f64', z:'f64' }); const Particle = struct({ pos: Vec3, vel: Vec3, life:'f32', id:'u32' })`
  - `expect(Particle.sizeof).toBe(56)`
  - Via `createSingleSlot(Particle)`:
    - Write `p.pos.x = 1.5`, `p.pos.y = 2.5`, `p.pos.z = 3.5`, `p.vel.x = -1`, `p.life = 0.25`, `p.id = 42`
    - Read each back and assert
    - Raw `DataView` offset verification: `view.getFloat64(0, true) === 1.5`, `view.getFloat64(24, true) === -1`, `view.getFloat32(48, true) === 0.25`, `view.getUint32(52, true) === 42`
  - Identity test: `p.pos === p.pos` (same object reference returned on repeated access — proves no per-access allocation)
  - Rebasing test: allocate an `ArrayBuffer` of size `Particle.sizeof * 2`. Construct a single handle at offset 0, write data, call `_rebase(view, Particle.sizeof)`, write different data, read back — both slots' bytes are distinct and correct.
  - Deeper nesting test: a 2-level nested struct (`struct({ outer: struct({ inner: Vec3 }) })`) writes through `h.outer.inner.x` and reads back — verifies recursive rebasing.

## Acceptance criteria
- [ ] Particle `sizeof === 56` and per-field byte offsets match `pos=0, vel=24, life=48, id=52`
- [ ] `p.pos === p.pos` (strict equality) across repeated access
- [ ] `grep -rn "Proxy" src/` still returns zero
- [ ] Generated handle source (or handle-codegen.ts logic) contains NO `new` expression inside any getter/setter body — only inside the constructor. Reviewer check; at minimum the emitted source strings for accessors must not contain `new `.
- [ ] `_rebase` correctly propagates to sub-handles (2-level test passes)
- [ ] All task-3 flat tests still pass unchanged
- [ ] `bun test` passes
- [ ] `bun run typecheck` exits 0

## Out of scope
- Any container implementation
- Iterator support
- `.drop()`
- String fields
- Exposing `_rebase` as public API (still internal)

## Notes
- Sub-handle reuse is what makes future `slab.get(i)` allocation-free. This task is the foundation for that.
- When the parent is first constructed at `baseOffset=0`, each sub-handle's initial base = `0 + <nestedOffset>`. When `_rebase(view, N)` is called, sub-handles become `N + <nestedOffset>`.
- Recursive codegen: for a nested struct field, the generated constructor must also know its child struct's own handle class so it can construct a child handle and later call `_rebase` on it. Access the child handle class via the nested `StructDef`'s internal handle constructor (same mechanism as task-3).
- Dotted offset computation: for verification purposes only. The runtime does NOT need a dotted-path offset table — nested access is handled by sub-handle chaining.
- All DataView calls remain little-endian (`true`).
