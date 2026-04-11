# Milestone 2 Goal — Phase 1b: `slab()` Core

## Objective

Deliver `slab()` — a fixed-capacity, slot-reusing container built on top of `struct()` from milestone-1. This is the first real container in RigidJS. It proves the blueprint/allocation separation works end-to-end and unlocks actual usage examples.

Reference: `.chief/_rules/_goal/rigidjs-design-spec-v3.md` §4.2 and §6.2.

## In Scope

1. **`slab(def, capacity)` constructor**
   - Allocates exactly one `ArrayBuffer` of size `def.sizeof * capacity`.
   - Creates one `DataView` wrapping the buffer.
   - Creates an occupancy bitmap: `Uint8Array(Math.ceil(capacity / 8))`.
   - Creates a free-list of slot indices (initially `[capacity-1, capacity-2, ..., 0]` so `insert()` fills from slot 0 upward).
   - Constructs **one** reusable handle instance up front (per the no-per-call-allocation rule).
   - Validates `capacity` is a positive integer.

2. **Slot-stamped handles**
   - When `insert()` returns a handle, the handle carries its slot index as an internal field (e.g. `_slot`).
   - `remove(handle)` reads that field to locate the slot. This matches the spec's `const p = slab.insert(); slab.remove(p)` ergonomics.
   - The handle instance itself is **reused** between calls. Two sequential `insert()` calls return the same handle object with different `_slot` / offset. Users who need persistent references must copy values out.
   - This reuse behavior is documented in JSDoc and has a test.

3. **Public API surface for milestone-2**
   ```ts
   export function slab<F>(def: StructDef<F>, capacity: number): Slab<F>

   export interface Slab<F extends StructFields> {
     insert(): Handle<F>
     remove(handle: Handle<F>): void
     get(index: number): Handle<F>
     has(handle: Handle<F>): boolean
     readonly len: number
     readonly capacity: number
     clear(): void
     drop(): void
     readonly buffer: ArrayBuffer
   }
   ```
   - `Handle<F>` is the type of the generated handle class; exported as a type alias so users can annotate.
   - `get(index)` rebases the reusable handle to `index`. Does NOT check occupancy — use `has()` for that.
   - `has(handle)` checks the occupancy bitmap at `handle._slot`. Also used to test arbitrary slots via `has(slab.get(i))`.
   - `len` tracks occupied slot count.
   - `clear()` wipes the bitmap and rebuilds the free-list. Keeps the buffer.
   - `drop()` nullifies the buffer reference and flips a `_dropped` flag. All subsequent operations throw.
   - `.buffer` is the escape hatch for power users.

4. **Error behavior**
   - `slab(def, 0)` or negative/non-integer capacity → throws.
   - `insert()` when full (free-list empty) → throws `"slab at capacity"`.
   - `get(index)` out of range → throws.
   - `remove(handle)` on an already-free slot → throws (double-free detection via bitmap check).
   - Any operation after `drop()` → throws `"slab has been dropped"`.

5. **Test coverage**
   - All numeric types round-trip through a slab (reuse task-3's patterns but via `slab` instead of `createSingleSlot`).
   - Insert → write → remove → insert → verify slot recycled.
   - Fill to capacity → next `insert()` throws.
   - `clear()` resets `len` to 0 and subsequent inserts start from slot 0 again.
   - `drop()` then any call throws.
   - Double-`remove()` throws.
   - Nested struct (Particle) stored in a slab, full round-trip.
   - `get(i)` returns handle pointing at correct offset — verified via raw DataView.
   - Handle reuse: `const a = s.insert(); a.x = 1; const b = s.insert(); b.x = 2; expect(s.get(0).x).toBe(1)` — proves handle reuse doesn't corrupt prior slot data.

6. **Real usage example**
   - `examples/particles.ts` — a runnable example using `struct()` + `slab()` to simulate N particles. Demonstrates the full loop: define struct, create slab, insert, mutate, remove, iterate via `get(i)` + `has()`. This doubles as end-to-end acceptance for the milestone.
   - Must be runnable via `bun run examples/particles.ts` with visible output.

## Out of Scope (Deferred)

- `.iter()` lazy chain (filter/map/take/etc.) — Phase 1e, own milestone
- `for..of slab` iteration protocol — pairs with `.iter()`, same future milestone
- `.insert({...})` object-form atomic write — deferred
- `vec()`, `bump()`, `bump.scoped()` — future milestones
- String field types — Phase 2
- Benchmark harness — still deferred
- CI pipeline — still deferred
- Multi-threading / SharedArrayBuffer

## Success Criteria

- [ ] `bun test` passes with all milestone-1 tests still green plus full milestone-2 coverage
- [ ] `bun run typecheck` passes
- [ ] `slab` and `Slab` exported from `rigidjs`
- [ ] `Handle<F>` type is usable as a type annotation
- [ ] No `Proxy` anywhere — grep confirms
- [ ] No per-call JS object allocation in `insert`/`remove`/`get`/`has` — handle is pre-built and reused, verified by code review against `_standard/memory-and-perf.md`
- [ ] `examples/particles.ts` runs cleanly and prints expected output
- [ ] `struct()` API (including `sizeof`, `fields`, behavior) is unchanged from milestone-1
- [ ] Zero runtime dependencies still

## Non-Negotiables

- Exactly **one** ArrayBuffer allocation per slab (bitmap is a separate tiny Uint8Array — that's fine; it's not "per item").
- Handle class is generated via `new Function()` (reuse the existing codegen).
- Free-list is a plain JS array of indices — pop to allocate, push to free. O(1) both ways.
- Bitmap occupancy check: bit `i` of byte `i >> 3` is 1 iff slot `i` is occupied.
- `insert()` fills slot 0 first on an empty slab (sort free-list descending so pop returns 0).

## Decisions Deferred to Chief-Agent During Planning

- Exact file split inside `src/slab/` (`slab.ts`, maybe `bitmap.ts`)
- Whether `Handle<F>` is re-exported from `src/index.ts` as a standalone type or inferred from `Slab<F>` return types
- Whether to expose `._slot` as a public readonly property on the handle or keep it private (default: private/internal, revisit if `vec()` needs it)
- Order of tasks (but the natural order is: types → bitmap/free-list → slab core → nested-in-slab + example + acceptance)
