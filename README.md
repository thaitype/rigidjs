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

`insert()` does not allocate a new object. It returns the **same shared handle instance** every call, rebased to the new slot. Field writes go straight through monomorphic TypedArray indexed access into the backing buffer.

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

### 4. Column access for hot loops

For maximum throughput in tight inner loops, bypass the handle entirely and work with raw TypedArray columns:

```ts
const posX = particles.column('pos.x')   // Float64Array view into the buffer
const velX = particles.column('vel.x')   // Float64Array view into the buffer

for (let i = 0; i < particles.len; i++) {
  posX[i] += velX[i] * dt
}
```

Zero handle overhead. Pure `Float64Array[i]` — the JIT compiles this to a single indexed memory load. On 100k entities, column access runs **2.7x faster than equivalent plain JS** code.

The column reference is resolved once (allocation-free on every call — the view is pre-built at slab creation) and the hot loop touches nothing but the two Float64Arrays. This is the "maximum speed" tier.

---

## Mental model

RigidJS asks you to keep a few things in mind. Once they click, the rest of the API follows.

### Memory layout — from objects to columns

A normal JS developer stores entities as objects in an array:

```ts
// Plain JS: one object per entity, each tracked by the GC
const points = [
  { x: 1.0, y: 2.0, hp: 100 },   // object 1
  { x: 3.0, y: 4.0, hp: 80 },    // object 2
  { x: 5.0, y: 6.0, hp: 60 },    // object 3
]
```

Each `{}` is a separate heap allocation with a hidden class, property storage, and GC metadata. At 100k entities that's 100k objects the garbage collector must track, scan, and eventually free.

RigidJS flips the layout. Instead of "one object per entity" (Array of Structs), it stores "one column per field" (Structure of Arrays):

```ts
const Point = struct({ x: 'f32', y: 'f32', hp: 'u8' })
const points = slab(Point, 3)
```

Inside the slab, **one** `ArrayBuffer` holds all the data, with each field stored as a contiguous column:

```
                    One ArrayBuffer (27 bytes)
  ┌─────────────────────┬─────────────────────┬──────────────┐
  │   x column          │   y column          │ hp column    │
  │   Float32Array      │   Float32Array      │ Uint8Array   │
  │                     │                     │              │
  │  [x₀]  [x₁]  [x₂]   │  [y₀]  [y₁]  [y₂]   │ [h₀][h₁][h₂] │
  │   4B    4B    4B    │   4B    4B    4B    │  1B  1B  1B  │
  └─────────────────────┴─────────────────────┴──────────────┘
       12 bytes               12 bytes            3 bytes
```

### Slots — how entities map to columns

A **slot** is a numeric index that identifies one entity across all columns. Slot 0 is the first entity, slot 1 is the second, and so on.

```
       slot:    0     1     2

  x column:  [ 1.0 | 3.0 | 5.0 ]    ← Float32Array, x[slot]
  y column:  [ 2.0 | 4.0 | 6.0 ]    ← Float32Array, y[slot]
  hp column: [ 100 |  80 |  60 ]    ← Uint8Array,   hp[slot]
```

Reading `points.get(1).x` means "look up index 1 in the x column" — a single `Float32Array[1]` indexed load. The JIT compiles this to one machine instruction. No property lookup, no hidden class check, no pointer chasing.

```
points.get(i).x   =>  xColumn[i]    // Float32Array[i], JIT-inlineable
points.get(i).y   =>  yColumn[i]    // Float32Array[i]
points.get(i).hp  =>  hpColumn[i]   // Uint8Array[i]
```

The handle is a tiny accessor class code-generated at `struct()` call time. Each getter captures its specific TypedArray directly — monomorphic, no polymorphic dispatch.

### Why this matters for the GC

```
Plain JS (3 entities):               RigidJS slab (3 entities):

  [Array]  <-- GC tracks this          [ArrayBuffer]  <-- GC tracks this
     |                                    + Float32Array view (x)
     +--> {x,y,hp}  <-- GC tracks        + Float32Array view (y)
     +--> {x,y,hp}  <-- GC tracks        + Uint8Array view (hp)
     +--> {x,y,hp}  <-- GC tracks

  GC tracks: 4 objects                 GC tracks: 4 objects
  Growth:    +1 object per insert      Growth:    0 objects per insert
```

At 3 entities the GC counts are similar. Now scale to **100,000 entities:**

```
Plain JS:   100,001 GC-tracked objects (array + 100k entity objects)
RigidJS:        ~368 GC-tracked objects (1 buffer + views + bookkeeping)
```

That's ~272x fewer objects. The GC has almost nothing to scan. When it does wake up, its job is trivial — a handful of long-lived buffers instead of a hundred thousand short-lived objects scattered across the heap. This is why RigidJS's worst-case GC pause is 6 ms while plain JS spikes to 53 ms under sustained load.

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

Single machine (Apple Silicon, Macbook Pro M4, Bun 1.3.8), one run, no statistical significance claims. Treat the shape of the numbers more than the digits.

### Iteration throughput — the headline result

| Scenario (100k entities) | Plain JS | RigidJS handle | RigidJS column |
|---|---:|---:|---:|
| B3 iterate + mutate `pos.x += vel.x` | 5,291 ops/s | **4,663 ops/s** (0.88x) | **14,244 ops/s** (2.69x) |

The handle API is within 12% of plain JS. The column API — resolving `slab.column('pos.x')` once and looping over the raw `Float64Array` — runs **2.7x faster than plain JS**. This is the payoff of the Structure-of-Arrays layout: iterating one field across all entities hits sequential cache lines.

### GC pressure — objects the collector must track per container

| Scenario | Plain JS | RigidJS | Advantage |
|---|---:|---:|---:|
| 100k `Vec3` | 100,106 | **368** | ~272x fewer |
| 50k nested `Particle` | 150,092 | **791** | ~190x fewer |

Two orders of magnitude fewer objects for the GC to scan and free.

### Sustained load — 10s of 1k insert + 1k remove + full iterate per tick at 100k capacity

| Metric | Plain JS | RigidJS | Result |
|---|---:|---:|---:|
| Mean tick | 0.187 ms | 0.184 ms | Parity |
| p99 tick | 0.814 ms | **0.300 ms** | RigidJS 2.7x better |
| p999 tick | 2.662 ms | **0.560 ms** | RigidJS 4.8x better |
| **Max tick** | **52.82 ms** | **5.99 ms** | **RigidJS 8.8x better** |

The 53 ms max tick for plain JS is a GC spike — it would drop 3 frames in a 60fps game loop. RigidJS's worst tick is 6 ms.

### Where RigidJS loses (honest)

- **Entity creation throughput.** `slab.insert()` with field writes is ~0.26x of plain JS object literal creation (B1, B7). If your workload is dominated by creating new entities rather than iterating existing ones, plain JS is faster.
- **Small-capacity RSS.** At 10k capacity, RigidJS pre-allocates the full buffer upfront, which can use more memory than needed. At 1M capacity the relationship inverts (JS ~642 MB, RigidJS ~462 MB).
- **Small capacities, workloads without latency SLAs, short-lived scripts.** Use plain JS. Seriously.

### Run it yourself

```bash
bun run bench
```

The harness lives in `benchmark/` and covers struct creation, insert/remove churn, iteration (handle + column), nested field access, sustained-load churn, and heap-scaling curves. Full writeups are under [`.chief/milestone-3/_report/`](.chief/milestone-3/_report/) — in particular [`milestone-3-summary.md`](.chief/milestone-3/_report/milestone-3-summary.md) for the narrative and [`task-4/benchmark.md`](.chief/milestone-3/_report/task-4/benchmark.md) for the complete comparison tables.

**The honest pitch:**
1. **2.7x faster iteration** via column access on 100k entities, measured.
2. **Two orders of magnitude less GC pressure**, measured.
3. **8.8x flatter tail latency** under sustained load, measured.
4. **Creation is slower** — 0.26x plain JS. Honest about the trade-off.

---

## Roadmap

Rough status at the time of writing. Anything unchecked is subject to redesign.

- [x] `struct()` — blueprint, field layout, nested structs, handle codegen
- [x] `slab()` — fixed-capacity container, insert, remove, has, get, clear, drop
- [x] Handle reuse invariant and `handle.slot` getter
- [x] SoA layout rewrite — single-buffer Structure-of-Arrays with monomorphic TypedArray codegen
- [x] `slab.column(name)` — typed column access for maximum throughput in hot loops
- [x] Benchmark harness with CPU, JIT counter, and heap time-series instrumentation
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
