# Task 3 — `slab()` Core Implementation

## Objective
Implement the `slab()` function, the `Slab<F>` interface, and the `Handle<F>` type alias. Deliver full method coverage (insert/remove/get/has/len/capacity/clear/drop/buffer), all error paths, handle reuse semantics, nested-struct storage, and exhaustive unit tests. Public API is wired up in task 4 — this task does NOT edit `src/index.ts`.

## Inputs (read before starting)
- `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_goal/goal.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_contract/public-api.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` §4.2 and §6.2
- Task-1 and task-2 outputs (slot-stamped handles + bitmap helpers)
- `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts` (post task-1 changes)
- `/Users/thada/gits/thaitype/rigidjs/src/slab/bitmap.ts`

## Deliverables
- `/Users/thada/gits/thaitype/rigidjs/src/slab/slab.ts`
  - Exports:
    ```ts
    export function slab<F extends StructFields>(
      def: StructDef<F>,
      capacity: number,
    ): Slab<F>

    export interface Slab<F extends StructFields> { /* per milestone-2 contract */ }

    export type Handle<F extends StructFields> = InstanceType<
      NonNullable<StructDef<F>['_Handle']>
    >
    ```
  - Internal construction:
    1. Validate `capacity`: must be an integer `> 0`. Otherwise throw `"slab: capacity must be a positive integer"`.
    2. Throw `"slab: StructDef has no _Handle — was it created by struct()?"` if `def._Handle` is missing.
    3. Allocate exactly one `ArrayBuffer` of `def.sizeof * capacity` bytes.
    4. Wrap in a single `DataView`.
    5. Allocate one `Uint8Array` of `bitmapByteLength(capacity)` bytes (initially zero).
    6. Build the free-list as a plain JS array seeded `[capacity-1, capacity-2, ..., 1, 0]` so `.pop()` returns `0` first.
    7. Construct **one** reusable handle via `new def._Handle(view, 0, 0)`.
    8. Initialize `_len = 0` and `_dropped = false`.
  - Public interface implementation (all methods check `_dropped` first and throw `"slab has been dropped"` if set):
    - `insert()`: pop slot from free-list. If undefined → throw `"slab at capacity"`. Set bitmap bit. Increment `_len`. Rebase the shared handle via `(handle as any)._rebase(view, slot * def.sizeof, slot)`. Return `handle`.
    - `remove(handle)`: read `(handle as any)._slot`. Check bitmap bit — if 0 → throw `"slab: double remove at slot " + slot`. Clear bitmap bit. Push slot onto free-list. Decrement `_len`.
    - `get(index)`: if `index < 0 || index >= capacity || !Number.isInteger(index)` → throw `"slab: index out of range"`. Rebase handle to `index`. Return handle. Does NOT check occupancy.
    - `has(handle)`: return `bitmapGet(bits, (handle as any)._slot)`.
    - `len`: readonly getter returning `_len`.
    - `capacity`: readonly — returned as a plain property or getter.
    - `clear()`: fill bitmap bytes with 0 (`bits.fill(0)`), rebuild free-list `[capacity-1, ..., 0]`, set `_len = 0`. Buffer untouched.
    - `drop()`: set `_dropped = true`, null out internal references to buffer/view/bits/freeList/handle (cast via local `any` to satisfy TS) so GC can reclaim them.
    - `buffer`: readonly property returning the `ArrayBuffer`. After `drop()` it must still throw on access (wrap in a getter that checks `_dropped`).
  - Return object shape: a single plain object literal (not a class) with getters and pre-bound method references. **Do not** create closures inside hot-path methods. Methods may be defined inline on the object literal; they close over the local scope once at `slab()` call time — this is the only allocation of closures and it's one-time, not per-call.
  - Internal `any` is tolerated at the handle-rebase / slot-read sites only; isolate with a comment explaining the boundary (per `_standard/typescript.md`).
- `/Users/thada/gits/thaitype/rigidjs/tests/slab/slab.test.ts`
  - **Construction**
    - `slab(Vec3, 10).capacity === 10`, `.len === 0`, `.buffer.byteLength === 24 * 10`.
    - `slab(Vec3, 0)` throws.
    - `slab(Vec3, -1)` throws.
    - `slab(Vec3, 1.5)` throws.
    - `slab(Vec3, NaN)` throws.
  - **Insert / get / field round-trip**
    - Insert one Vec3, write `x=1, y=2, z=3`. `len === 1`. Read back via the returned handle.
    - Insert fills slot 0 first: after one insert, `get(0)` returns a handle whose field reads match slot 0's raw DataView bytes.
    - All 8 numeric types: for each type `T`, define `struct({ v: T })`, slab it, insert, write a representative value, read it back. Use a value table identical in spirit to the milestone-1 `handle-flat.test.ts`.
  - **Handle reuse semantics**
    - `const a = s.insert(); const b = s.insert(); expect(a === b).toBe(true)` — reference equality.
    - `a.x = 1; b.x = 2; expect(s.get(0).x).toBe(1); expect(s.get(1).x).toBe(2)` — prior slot untouched when handle is rebased.
  - **Slot recycling**
    - Capacity 2: insert a, insert b, `remove(a)`, insert c → `c`'s slot should be 0 (the freed slot), verify via raw DataView read at offset 0 or via `(handle as any)._slot`.
    - `len` tracks correctly across insert/remove sequences.
  - **Capacity exhaustion**
    - Fill slab to capacity, next `insert()` throws `"slab at capacity"`.
  - **clear()**
    - Fill to capacity, `clear()`, assert `len === 0`, then insert again → next slot is 0 (free-list rebuilt correctly).
    - `clear()` does NOT reallocate the buffer: `s.buffer` is the same reference before and after.
  - **drop()**
    - `s.drop()`; subsequent `insert()`, `remove(h)`, `get(0)`, `has(h)`, access `.len`, access `.capacity`, access `.buffer`, `clear()` all throw `"slab has been dropped"`.
    - Calling `drop()` twice is allowed or throws — pick one and document. Default: throws `"slab has been dropped"` on the second call (consistent with all other post-drop operations).
  - **Error paths**
    - `get(-1)`, `get(capacity)`, `get(0.5)`, `get(NaN)` each throw.
    - Double `remove(h)` on the same slot throws `"slab: double remove at slot 0"` (or matching message).
  - **has()**
    - After `insert()` → `has(h) === true`.
    - After `remove(h)` → `has(h) === false`.
    - `has(slab.get(i))` works because `get()` rebases the shared handle to slot `i` and `has` reads `_slot`.
  - **Nested struct**
    - `const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })`, `slab(Particle, 100)`.
    - Insert 3 particles with distinct `pos.x` and `id`. Verify `get(0).pos.x`, `get(1).id`, etc. round-trip.
    - Verify offsets via raw DataView (read `getFloat64(56 * 1 + 0, true)` to confirm slot 1's `pos.x` is where expected).
  - **No new public exports**
    - `import * as pkg from '../../src/index'` — assert `pkg.slab === undefined` in this task (task 4 turns it on). This test is the canary that prevents a premature public leak.

## Acceptance criteria
- [ ] `bun test` passes — all milestone-1 tests still green plus every new slab test
- [ ] `bun run typecheck` exits 0
- [ ] `grep -rn "Proxy" src/` returns zero matches
- [ ] `grep -rn "new Function" src/` still matches only inside `src/struct/handle-codegen.ts`
- [ ] `grep -n "slab" src/index.ts` returns zero matches (task-4 wires it)
- [ ] `Handle<F>` and `Slab<F>` are usable as type annotations inside `src/slab/slab.ts` tests
- [ ] No closure allocation inside `insert`/`remove`/`get`/`has`/`clear` — verified by code review against `_standard/memory-and-perf.md`. Closures are permitted **only** at `slab()` call time when building the return object literal.
- [ ] Exactly ONE `new ArrayBuffer(...)` call in `src/slab/slab.ts`
- [ ] Exactly ONE `new DataView(...)` call in `src/slab/slab.ts`
- [ ] Insert-then-insert returns the same handle instance (reference equality test passes)
- [ ] Every error message listed above matches exactly (tests assert via `toThrow(/.../)`)

## Out of scope
- `.iter()` / `for..of` / object-form `insert({...})` — deferred
- Public re-export from `src/index.ts` — task 4
- `examples/particles.ts` — task 4
- Benchmarks / perf gates

## Notes
- **Free-list seeding.** Use a `for (let i = capacity - 1; i >= 0; i--) freeList.push(i)` loop. `pop()` then returns `0, 1, 2, ...` in order. This matches the spec's mental model "first insert fills slot 0".
- **Bitmap byte length.** Use `bitmapByteLength(capacity)` from task 2 — do not inline the `Math.ceil` formula here.
- **Handle rebase call.** `(handle as any)._rebase(view, slot * def.sizeof, slot)` — the `_rebase` signature comes from task 1. Keep the `any` cast isolated to this one line with a comment.
- **`_dropped` guard.** The clean pattern is a helper function inside the slab closure:
  ```ts
  function assertLive(): void { if (_dropped) throw new Error('slab has been dropped') }
  ```
  This helper is created once at `slab()` call time (one closure allocation, one-time), not per call.
- **`.buffer` is readonly.** Type it as `readonly buffer: ArrayBuffer` on the `Slab<F>` interface. The returned object should define it via a getter so the drop check runs. The contract allows reading only — never reassignment.
- **`Slab<F>` interface lives in `src/slab/slab.ts`** alongside the `slab()` function. Task 4 re-exports it as a type from `src/index.ts`.
- **Do not expose `_slot`** as a property on the `Slab<F>` or `Handle<F>` public types. Tests reach it via `(h as any)._slot` only.
- **`has(handle)` vs `has(slot)`.** Public API takes only a handle. Since `get(i)` returns the same handle rebased to slot `i`, `s.has(s.get(i))` is the way to check arbitrary slot occupancy. No separate index-based has method.
- **File size guidance.** Target under 200 source lines in `slab.ts`. If the task-3 author finds it runs much longer, stop and escalate — the planner will split into `slab.ts` (insert/remove/get/has/len/capacity/buffer) and a follow-up task for `clear`/`drop`/error surfaces.
