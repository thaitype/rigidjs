> **Status: Experimental · Educational purposes.** APIs may change without notice.
> Not published to npm. This project is a learning exercise and design exploration.
> It may turn into something useful in the future — or it may not. No warranty, no promises.

# RigidJS

**Memory primitives for JavaScript. Make memory easy to digest.**

Fixed-capacity, contiguous, allocation-free data structures backed by `ArrayBuffer`. A small kit of primitives — `struct`, `slab`, and more to come — for writing code that does not fight the garbage collector in hot paths.

Inspired by Rust's memory model. Not trying to be Rust.

---

## Why this exists

JavaScript has a garbage collector and that is not changing. Any library that pretends otherwise is lying. RigidJS takes the opposite stance: **accept the GC, then feed it less**.

The idea is to borrow techniques from systems languages — contiguous memory, typed fields, handle reuse, slot-based addressing — and package them in a way that is comfortable to use from JavaScript. Not to beat Rust. Not to rewrite the runtime. Just to give hot-path code a shape the engine already likes.

Three guiding principles:

- **GC-friendly by design.** Allocate once at container creation, reuse forever. No per-call object allocation in insert, get, remove, or field access. The less garbage we produce, the less work the collector has to do.
- **Easy for the GC to bite, easy for the GC to digest.** We cannot control when the collector runs. We can control what it sees. A slab of 10,000 particles is **one** long-lived `ArrayBuffer` to the GC — one large, opaque allocation instead of ten thousand small objects with hidden classes, inline caches, and pointer chasing. When the collector does wake up, its job is trivial: one edge to scan, one buffer to eventually free. That is the shape we are after.
- **Honest about trade-offs.** Fixed capacity is a feature, not a bug. Handles are shared and rebased — not copied. Reading the docs is part of the deal.

---

## Installation

RigidJS is **not on npm yet**. To try it:

```bash
git clone https://github.com/thaitype/rigidjs.git
cd rigidjs
bun install
bun test
bun run examples/particles.ts
```

Requires [Bun](https://bun.com) (runtime + test runner) and TypeScript 5.

---

## Quick look

RigidJS has two ideas you need to understand before anything else makes sense: `struct` defines a shape, and `slab` allocates storage for many of that shape.

### 1. Define a struct

A struct describes the memory layout of one record. It allocates nothing by itself.

```ts
import { struct } from 'rigidjs'

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

const Particle = struct({
  pos: Vec3,     // nested structs are inlined — 24 bytes here
  vel: Vec3,     // 24 bytes
  life: 'f32',   // 4 bytes
  id: 'u32',     // 4 bytes
})
// sizeof(Particle) === 56 bytes
```

Fields are laid out in declaration order. No reordering, no padding. Nested structs are embedded inline, not stored as pointers.

### 2. Allocate a slab

A slab owns an `ArrayBuffer` sized for a fixed number of slots. It is the container.

```ts
import { slab } from 'rigidjs'

const particles = slab(Particle, 10_000)
// Single ArrayBuffer: 56 × 10,000 = 560,000 bytes — allocated once.

const p = particles.insert()   // returns a shared handle rebased to the new slot
p.pos.x = 100
p.pos.y = 0
p.vel.y = -9.8
p.life = 1.0
p.id = 42
```

`insert()` does not allocate a new object. It returns the **same shared handle instance** every call, rebased to the new slot. Field writes go straight through a `DataView` into the backing buffer.

### 3. Iterate and remove

Because the handle is shared, stable references are held as numeric slots — not as handle objects.

```ts
const slotA = particles.insert().slot   // capture the number

// Iterate occupied slots
for (let i = 0; i < particles.capacity; i++) {
  if (!particles.has(i)) continue
  const h = particles.get(i)
  h.pos.x += h.vel.x
  h.life -= 0.016
}

// Remove by slot
particles.remove(slotA)

// Release the entire buffer when done
particles.drop()
```

That is the whole mental model. Everything else is details.

---

## Mental model

RigidJS asks you to keep three things in mind. Once they click, the rest of the API follows.

### Blueprint vs container

`struct()` is a **blueprint**. It computes field offsets and sizes but allocates no memory. `slab()` is a **container**. It owns an `ArrayBuffer` and hands out handles that read and write slots inside that buffer. The same blueprint can back multiple containers.

### Shared handles, not per-item objects

A handle is a thin accessor, not a record. Every slab has **one** handle instance per struct type, and `insert()` / `get(i)` rebase that instance to the requested slot and return it. The payoff is zero per-call allocation. The cost is that you cannot hold a handle reference across calls — it will move under you. Capture `handle.slot` (a primitive `number`) if you need a stable reference.

### Slots are just numbers

A slot is an integer index in `[0, capacity)`. It names a fixed location in the buffer. `remove(slot)`, `has(slot)`, and `get(slot)` all take numeric slots because numbers cannot go stale, cannot rebase, and cost nothing to pass around.

---

## Examples

Two runnable examples live in `examples/`:

- [`examples/particles.ts`](examples/particles.ts) — end-to-end particle simulation with deterministic LCG, tick integration, and a slab consistency check. Run with `bun run examples/particles.ts`.
- [`examples/basic.ts`](examples/basic.ts) — minimal struct + slab sketch.

The particle example is the best single file to read next. It demonstrates every invariant in use.

---

## Benchmarks

Performance is a primary goal, but RigidJS does **not** publish fixed speedup numbers in this README — those go stale, and the comparison depends heavily on the workload. A benchmark harness is included so you can measure on your own machine.

```bash
bun run bench
```

The harness lives in `benchmark/` and covers struct creation, insert/remove churn, iteration, nested field access, and sustained-load scaling. Results include CPU time, high-water RSS, and heap pressure. Treat the numbers as signal about shape, not as marketing claims.

---

## Roadmap

Rough status at the time of writing. Anything unchecked is subject to redesign.

- [x] `struct()` — blueprint, field layout, nested structs, handle codegen
- [x] `slab()` — fixed-capacity container, insert, remove, has, get, clear, drop
- [x] Handle reuse invariant and `handle.slot` getter
- [x] Benchmark harness
- [ ] `slab.iter()` — lazy iteration with borrow protection
- [ ] `slab.insert({...})` — atomic object-literal insertion with validation
- [ ] `vec()` — growable, ordered container
- [ ] `bump()` — arena allocator for transient work
- [ ] Strings — length-prefixed, interned, or inline — design pending
- [ ] npm publication and semver commitment

The authoritative long-form design is at [`.chief/_rules/_goal/rigidjs-design-spec-v3.md`](.chief/_rules/_goal/rigidjs-design-spec-v3.md). Expect it to evolve.

---

## Project status

This is an **experimental, educational project**. Writing it down explicitly so nobody gets surprised:

- **API will break.** Nothing is stable. Names, signatures, and semantics can change between commits.
- **No security guarantees.** There is no threat model. Do not feed untrusted input through `insert({...})` when it lands.
- **Not production-ready.** If you are reaching for RigidJS to solve a deadline, reach for a proven library instead.
- **Not published to npm.** Clone the repo to try it.
- **May or may not turn into a real library.** The goal right now is to learn by building, share the design, and see what happens.

If any of that gives you pause, this is not the library for your use case yet. If you are here to learn or to explore, welcome.

---

## Development

```bash
bun install           # install dev dependencies
bun test              # run unit tests (bun:test)
bun run typecheck     # tsc --noEmit, strict mode
bun run bench         # run benchmark harness
```

Definition of done for any change: `bun test` passes and `bun run typecheck` passes. The project uses a structured planning framework under `.chief/` — see [`CLAUDE.md`](CLAUDE.md) if you are curious about how it is organized.

---

## Contributing

Thanks for considering it. **During the experimental phase, PRs are on hold** — the design is still in motion and accepting outside changes would only create churn. Issues and discussion are very welcome: design questions, bug reports, benchmark surprises, documentation gaps, and "I tried to use this and ran into X" feedback all help.

Open an issue at [github.com/thaitype/rigidjs/issues](https://github.com/thaitype/rigidjs/issues).

Once the core primitives stabilize and the project is published, this will change and a full `CONTRIBUTING.md` will land.

---

## License

[MIT](LICENSE) © Thada Wangthammang

---

## Acknowledgments

The memory model is heavily inspired by Rust — specifically the `slab` crate, arena allocators like `bumpalo`, and the general Rust pattern of contiguous storage plus stable keys. RigidJS is not Rust; it runs inside a garbage-collected JavaScript engine and makes peace with that. The goal is to bring the parts of that mental model that translate cleanly, and to be honest about the parts that do not.
