# RigidJS Design Specification

**Version:** 0.3.0-draft
**Runtime:** Bun (JavaScriptCore)
**Language:** TypeScript

> Rust-inspired memory primitives for JavaScript.
> Squeeze every bit of performance possible.
> `struct` • `slab` • `vec` • `bump` • `iter` • `drop`

---

## 1. Problem Statement

JavaScript's garbage collector introduces three costs that Rust and C avoid at compile time:

1. **GC Pressure** — Every `{}` creates an object the GC must track. 100k objects = 100k items to scan and collect, causing unpredictable latency spikes (2ms–200ms+).
2. **Shape Deoptimization** — Adding/deleting properties changes an object's hidden class. The JIT abandons optimized machine code and falls back to slow dictionary lookups (2–20x slower).
3. **Invisible Memory Lifetime** — No way to know when memory is freed. Objects pile up until GC decides to collect, causing sawtooth memory patterns and tail latency.

RigidJS solves these by providing new primitives that store data in contiguous `ArrayBuffer` memory instead of JS objects. The GC sees one ArrayBuffer, not millions of objects.

---

## 2. Design Philosophy

**"What if JavaScript had `struct`, `Vec`, and `drop()`?"**

Rust doesn't "optimize C" — it provides new primitives (ownership, borrowing, lifetimes) that make memory bugs impossible by construction. RigidJS takes the same approach.

Principles:

- **Squeeze every bit of performance** — Provide every possible option for users to optimize their specific use case.
- **Explicit over magic** — No hidden transforms. Users see exactly what memory is allocated.
- **Rust naming** — Every API maps to a documented Rust concept. Google "rust slab crate" to learn more.
- **Incremental adoption** — Use RigidJS only in hot paths. Everything else stays normal JS.
- **Bun-first** — Leverage `bun:jsc`, `Bun.mmap()`, `bun:ffi` where beneficial.

---

## 3. Phased Delivery

### Phase 1: Numeric Types + Core Containers

All numeric struct fields, all containers (slab, vec, bump), iter, drop.
No string support. This phase alone covers game engines, simulations, sensor data, financial calculations — any use case where data is primarily numeric.

### Phase 2: String Support

Two string types (`str:N` and `string`) added to struct.
This phase extends RigidJS to cover API servers, product catalogs, user data — any use case with mixed numeric + text data.

---

## 4. Phase 1: Numeric Core

### 4.1 `struct()` — Define a Fixed-Layout Type

**Rust equivalent:** `struct { field: Type }`

A struct defines a fixed set of typed fields stored in contiguous bytes. Once defined, the shape never changes. Struct is only a blueprint (no memory allocation). Containers (slab, vec, bump) create the actual ArrayBuffer.

```typescript
import { struct } from 'rigidjs'

const Vec3 = struct({
  x: 'f64',
  y: 'f64',
  z: 'f64',
})
// sizeof: 24 bytes. No ArrayBuffer created yet — just a definition.

// Nested structs are embedded inline (not a pointer)
const Particle = struct({
  pos:  Vec3,       // 24 bytes inline
  vel:  Vec3,       // 24 bytes inline
  life: 'f32',     // 4 bytes
  id:   'u32',     // 4 bytes
})
// sizeof: 56 bytes contiguous. All fields inline, no pointers.
```

**Available numeric types (Phase 1):**

| Type | Bytes | TypedArray | Range |
|------|-------|------------|-------|
| `f64` | 8 | Float64Array | ±1.8×10³⁰⁸ |
| `f32` | 4 | Float32Array | ±3.4×10³⁸ |
| `u32` | 4 | Uint32Array | 0 – 4,294,967,295 |
| `u16` | 2 | Uint16Array | 0 – 65,535 |
| `u8` | 1 | Uint8Array | 0 – 255 |
| `i32` | 4 | Int32Array | -2B – 2B |
| `i16` | 2 | Int16Array | -32,768 – 32,767 |
| `i8` | 1 | Int8Array | -128 – 127 |

**Memory layout:** Fields are stored in declaration order (no reordering). Unaligned access is handled by DataView, which is safe and performant on modern JS engines. No padding is added.

```
Particle memory layout (56 bytes):
+0   pos.x   f64  [████████]
+8   pos.y   f64  [████████]
+16  pos.z   f64  [████████]
+24  vel.x   f64  [████████]
+32  vel.y   f64  [████████]
+40  vel.z   f64  [████████]
+48  life    f32  [████]
+52  id      u32  [████]
```

**Why this is faster than plain JS:**

A plain JS `{ pos: { x, y, z }, vel: { x, y, z }, life, id }` creates 3 separate objects (parent + pos + vel), each with hidden class (~8B), GC metadata (~16B), property storage (~24B), and boxed numbers (~16B each). Total: ~504 bytes, 3 GC-tracked objects.

A RigidJS struct stores the same data in exactly 56 contiguous bytes. The GC tracks 0 additional objects (only the container's ArrayBuffer).

---

### 4.2 `slab()` — Pre-Allocated Reusable Slots

**Rust equivalent:** `slab` crate (used internally by Tokio)

Pre-allocates N fixed slots in one ArrayBuffer. Items can be inserted and removed individually. Removed slots are recycled by future inserts.

```typescript
import { struct, slab } from 'rigidjs'

// Reserve 50k slots: ArrayBuffer(56 × 50,000) = 2.8MB, one chunk
const particles = slab(Particle, 50_000)

// .insert() — fill next free slot, returns a handle
const p = particles.insert()
p.pos.x = 100
p.vel.y = -9.8
p.life = 1.0

// Iterate occupied slots
for (const p of particles) {
  p.pos.x += p.vel.x
  p.life -= 0.016
}

// .remove() — mark slot as free (reused by next insert)
particles.remove(p)

// .drop() — release entire ArrayBuffer
particles.drop()
// particles.insert() after drop → throws Error
```

**Properties and methods:**

| API | Returns | Description |
|-----|---------|-------------|
| `.insert()` | handle | Fill next free slot |
| `.insert({...})` | handle | Validate all fields then write atomically |
| `.remove(handle)` | void | Free slot for reuse |
| `.get(index)` | handle | Access slot by index |
| `.has(handle)` | boolean | Check if slot is occupied |
| `.len` | number | Current occupied slot count |
| `.capacity` | number | Max slots |
| `.clear()` | void | Mark all slots free (keeps buffer) |
| `.drop()` | void | Release buffer. Throws on subsequent use. |
| `.iter()` | Iterator | Lazy iterator over occupied slots |
| `.buffer` | ArrayBuffer | Underlying memory (escape hatch) |

**When to use:** Game entities, connection pools, object managers — items are created and destroyed frequently, max count is known.

---

### 4.3 `vec()` — Growable Contiguous Collection

**Rust equivalent:** `Vec<T>`

Like slab but growable and ordered. When capacity is exceeded, allocates a new larger buffer and copies data. Items are accessed by index.

```typescript
import { struct, vec } from 'rigidjs'

const Point = struct({ x: 'f64', y: 'f64' })

const points = vec(Point, 100)   // start with capacity 100

const p = points.push()          // append to end
p.x = 42; p.y = 99

points.get(0).x                  // access by index: 42
points.len                       // 1

// Grows automatically when full (capacity doubles)
for (let i = 0; i < 200; i++) {
  const p = points.push()
  p.x = i
}
// capacity: 100 → 200 → 400

points.pop()                     // remove last
points.drop()                    // release buffer
```

**Methods:**

| API | Returns | Description |
|-----|---------|-------------|
| `.push()` | handle | Append new item at end |
| `.pop()` | void | Remove last item |
| `.get(index)` | handle | Access by index |
| `.len` | number | Current item count |
| `.capacity` | number | Current buffer capacity |
| `.clear()` | void | Reset length to 0 (keeps buffer) |
| `.drop()` | void | Release buffer |
| `.iter()` | Iterator | Lazy iterator |

**slab vs vec:**

| | slab | vec |
|---|---|---|
| Capacity | Fixed at creation | Grows when full |
| Insert/Remove | Any slot, O(1) | Append/pop end only |
| Order | Unordered (slots reused) | Ordered (contiguous) |
| Use case | Entities (come and go) | Lists (append and iterate) |

---

### 4.4 `bump()` — Temporary Fast Allocator

**Rust equivalent:** `bumpalo` crate

The fastest possible allocator. Alloc = increment a pointer. No per-item free. Drop everything at once.

```typescript
import { struct, bump } from 'rigidjs'

const TmpVec = struct({ x: 'f64', y: 'f64' })

const tmp = bump(TmpVec, 1000)

const a = tmp.alloc()            // just advances pointer (fastest)
a.x = 10; a.y = 20

// Cannot free individually — only everything at once:
tmp.drop()
```

**`bump.scoped()` — auto-drop when callback returns:**

```typescript
const result = bump.scoped(TmpVec, 1000, (tmp) => {
  let minDist = Infinity
  for (let i = 0; i < 1000; i++) {
    const v = tmp.alloc()
    v.x = Math.random() * 100
    v.y = Math.random() * 100
    const dist = Math.sqrt(v.x ** 2 + v.y ** 2)
    if (dist < minDist) minDist = dist
  }
  return minDist  // return primitive — safe to escape
})
// tmp.drop() called automatically here
```

**Methods:**

| API | Returns | Description |
|-----|---------|-------------|
| `.alloc()` | handle | Advance pointer, return next slot |
| `.used` | number | Items allocated so far |
| `.capacity` | number | Max items |
| `.reset()` | void | Reset pointer to 0 (reuse buffer) |
| `.drop()` | void | Release buffer |
| `bump.scoped(T, n, fn)` | fn result | Auto-drop when fn returns |

**Performance comparison:**

| Allocator | Alloc cost | Free individual | Free all |
|-----------|-----------|-----------------|----------|
| JS `new Object()` | ~10ns + GC tracking | Cannot (wait for GC) | Cannot |
| `slab.insert()` | ~5ns (free-list pop) | ~3ns (free-list push) | ~0ns (.drop) |
| `vec.push()` | ~3ns (pointer + write) | ~1ns (.pop) | ~0ns (.drop) |
| `bump.alloc()` | ~1ns (pointer++) | Not supported | ~0ns (.drop) |

---

### 4.5 `.iter()` — Lazy Iterator Chain

**Rust equivalent:** `.iter().filter().map().take()`

Chain operations without creating intermediate arrays. Nothing executes until a terminal method is called.

```typescript
const particles = slab(Particle, 50_000)

// Lazy chain — nothing executes yet
const nearbyCount = particles.iter()
  .filter(p => p.life > 0)
  .filter(p => p.pos.x ** 2 + p.pos.y ** 2 < 10000)
  .count()   // execute: single pass, zero intermediate arrays

// Reduce
const totalLife = particles.iter()
  .filter(p => p.life > 0)
  .reduce(0, (sum, p) => sum + p.life)

// Take (stops early)
const first5 = particles.iter()
  .filter(p => p.life > 0)
  .take(5)
  .collect()

// Zero-alloc transform: container → container
const Dist = struct({ id: 'u32', dist: 'f64' })
const distances = particles.iter()
  .filter(p => p.life > 0)
  .mapTo(Dist, (p, out) => {
    out.id = p.id
    out.dist = Math.sqrt(p.pos.x ** 2 + p.pos.y ** 2)
  })
// distances is Vec<Dist> — zero JS objects created
```

**Lazy methods (return iterator):**

| Method | Description |
|--------|-------------|
| `.filter(fn)` | Keep items where fn returns true |
| `.map(fn)` | Transform each item (creates JS values) |
| `.mapTo(Struct, fn)` | Transform into output vec (zero-alloc) |
| `.take(n)` | Stop after n items |
| `.skip(n)` | Skip first n items |

**Terminal methods (execute the chain):**

| Method | Returns | Description |
|--------|---------|-------------|
| `.count()` | number | Count matching items |
| `.reduce(init, fn)` | T | Fold into single value |
| `.collect()` | Array | Materialize into JS array |
| `.first()` | handle or null | First matching item |
| `.some(fn)` | boolean | Any match? |
| `.every(fn)` | boolean | All match? |
| `.forEach(fn)` | void | Execute for each (eager) |

---

### 4.6 `.drop()` — Deterministic Memory Release

**Rust equivalent:** `drop()` / `Drop` trait

```typescript
const particles = slab(Particle, 50_000)
// ... use ...
particles.drop()
// ArrayBuffer released immediately
// particles.insert() after drop → throws Error
```

**Comparison across languages:**

| Language | Free mechanism | Forget to free | Use after free |
|----------|---------------|----------------|----------------|
| C | `free()` manual | Memory leak | Crash (UB) |
| Rust | `drop` automatic at scope end | Impossible (compiler) | Compile error |
| JS | None (wait for GC) | N/A | N/A |
| RigidJS | `.drop()` explicit | Memory leak | Throws Error |
| RigidJS | `bump.scoped()` automatic | Impossible (callback) | Impossible |

---

## 5. Phase 2: String Support

### 5.1 Two String Types

Phase 2 adds two string field types to struct, each optimized for different use cases:

```typescript
const Product = struct({
  id:       'u32',
  price:    'f64',
  sku:      'str:12',     // UTF-8 bytes inline in ArrayBuffer
  name:     'string',     // JS string reference
})
```

### 5.2 `str:N` — UTF-8 Bytes Inline

**Rust equivalent:** `[u8; N]` / `heapless::String<N>` / `arrayvec::ArrayString<N>`

Stores UTF-8 encoded bytes directly in the ArrayBuffer as a fixed N-byte field. No JS string object is created on the heap. GC does not track individual strings.

**Internal layout:**

```
str:12 field (12 bytes total):
┌──────┬──────────────────────────┐
│ len  │ data                     │
│ u16  │ 10 bytes UTF-8           │
│ [05] │ [S,K,U,0,1,0,0,0,0,0]   │
└──────┴──────────────────────────┘
  2B     10B                = 12 bytes
```

**Setter:** Accepts JS string, auto-encodes to UTF-8 bytes.

```typescript
p.sku = 'SKU01'
// JS string → TextEncoder.encodeInto() → bytes written to ArrayBuffer
// Cost: ~80ns
```

**Getter:** Returns a `Str` object — not a JS string.

`Str` provides all common JS string methods. Internally, it uses two strategies:

- **Byte-level operations (no decode):** `equals`, `startsWith`, `endsWith`, `includes`, `compareTo`, `isEmpty`, `byteLength`. Arguments are auto-encoded and cached — first call encodes, subsequent calls use cached bytes.
- **Character-level operations:** `toUpperCase`, `toLowerCase`, `trim`, `slice`. Uses ASCII fast path (direct byte manipulation, ~5ns/char) when all bytes < 128. Falls back to decode → JS method → encode for non-ASCII (~200ns).

All methods that return string data return `Str` (enabling chaining). Terminal methods return JS primitives.

```typescript
// Byte-level — fast, no decode, auto encode + cache arguments
p.sku.equals('SKU01')           // ~60ns first, ~10ns cached
p.sku.startsWith('SKU')         // ~50ns first, ~10ns cached
p.sku.includes('01')            // cached byte search
p.sku.compareTo(other.sku)      // byte compare

// Character-level — ASCII fast path or decode fallback
p.sku.toUpperCase()             // → Str (ASCII: ~5ns/char)
p.sku.trim()                    // → Str
p.sku.toUpperCase().equals('SKU01')  // chain

// Terminal — return JS primitives
p.sku.length                    // char count (number)
p.sku.indexOf('K')              // number
p.sku.split('-')                // string[]

// Auto conversion — JS calls toString() automatically
`SKU: ${p.sku}`                 // → 'SKU: SKU01'
console.log(p.sku)              // → 'SKU01'
JSON.stringify({ sku: p.sku })  // → '{"sku":"SKU01"}'

// Raw access
p.sku.bytes                     // Uint8Array view (no copy)
p.sku.toString()                // explicit decode to JS string
```

**Known limitation:** `===` does not work with `Str` (it compares object references, not values). Use `.equals()` instead. `==` works (triggers `toString()`).

**Overflow behavior:**

```typescript
// Default: throw on overflow
const T = struct({ code: 'str:8' })

// Option: truncate at UTF-8 character boundary
const T = struct({
  code: { type: 'str:8', overflow: 'truncate' }
})
```

### 5.3 `string` — JS String Reference

Stores only a reference index (u32) in the ArrayBuffer, pointing to a JS string in a side array. The JS string itself lives on the JS heap and is tracked by GC.

```typescript
p.name = 'Mechanical Keyboard'   // store JS string ref
p.name                            // returns JS string directly (~3ns)
p.name === 'Mechanical Keyboard'  // ✅ works (it IS a JS string)
p.name.toUpperCase()              // ✅ native JS method
p.name.includes('Key')            // ✅ native JS method
```

No encoding, no decoding, no `Str` wrapper. It's a regular JS string.

**Trade-off:** GC still tracks each string. 100k items with `string` field = 100k JS strings on heap. Object overhead is eliminated but string GC remains.

### 5.4 When to Use Which

| | `str:N` | `string` |
|---|---|---|
| **GC** | Zero — bytes in ArrayBuffer | 1 JS string per item |
| **Read speed** | ~100ns (decode) or ~3ns (ASCII byte op) | ~3ns (pointer) |
| **Write speed** | ~80ns (encode) | ~3ns (set ref) |
| **JS `===`** | ❌ use `.equals()` | ✅ works |
| **Native methods** | Via `Str` (byte ops + fallback) | ✅ native |
| **Max length** | Fixed N bytes | Unlimited |
| **Padding waste** | Yes (unused bytes in N) | None |
| **Best for** | Short, compare-heavy, known max length | Long, display-heavy, variable length |
| **Examples** | status, code, tag, country, sku | name, description, url, email |

### 5.5 GC Impact Comparison (100k items, 2 string fields each)

| Approach | GC Objects | Memory |
|----------|-----------|--------|
| Plain JS objects | 300k (100k objects + 200k strings) | ~27MB |
| RigidJS `str:N` + `str:N` | 1 (ArrayBuffer only) | ~11MB |
| RigidJS `str:N` + `string` | 100,001 (1 buffer + 100k strings) | ~14MB |
| RigidJS `string` + `string` | 200,001 (1 buffer + 200k strings) | ~17MB |

### 5.6 Encode Cache Configuration

```typescript
// Default: cache enabled
const items = slab(T, 50_000)

// Disable cache (save memory, pay encode cost every time)
const items = slab(T, 50_000, { stringCache: false })

// Limit cache size (LRU eviction)
const items = slab(T, 50_000, { stringCacheSize: 100 })
```

---

## 6. Implementation Details

### 6.1 Handle Design

A handle is a lightweight accessor that reads/writes directly to the ArrayBuffer at a computed offset. Implemented as a code-generated class (like Elysia's Sucrose approach using `new Function()`) for maximum performance — eliminates Proxy overhead and allows JIT inlining.

```typescript
// struct() generates at define-time:
class ParticleHandle {
  constructor(private view: DataView, private off: number) {}
  get pos_x() { return this.view.getFloat64(this.off + 0) }
  set pos_x(v) { this.view.setFloat64(this.off + 0, v) }
  get life() { return this.view.getFloat32(this.off + 48) }
  set life(v) { this.view.setFloat32(this.off + 48, v) }
  // ... generated for every field
}
```

### 6.2 Container Internal Structure

```
slab(Particle, 1000):
  ├── ArrayBuffer (56 × 1000 = 56KB)
  ├── DataView (wraps ArrayBuffer for mixed-type read/write)
  ├── Uint8Array (occupancy bitmap — which slots are used)
  ├── Free-list array [slot indices available for reuse]
  └── String side-array (Phase 2 only, for 'string' fields)
```

### 6.3 Phased Delivery Schedule

| Phase | Deliverable | Weeks |
|-------|-------------|-------|
| 1a | `struct()` with numeric types | 1–2 |
| 1b | `slab()` with insert/remove/iter | 3–5 |
| 1c | `vec()` with push/pop/grow | 6–7 |
| 1d | `bump()` + `bump.scoped()` | 8–9 |
| 1e | `.iter()` lazy chain (filter/map/take/reduce) | 10–12 |
| 1f | `.mapTo()` zero-alloc container-to-container transform | 13–14 |
| 2a | `str:N` type + `Str` class with byte ops + ASCII fast path | 15–18 |
| 2b | `string` type (JS string reference) | 19–20 |
| 2c | Encode cache (auto + LRU) | 21–22 |
| 2d | `Str` full JS string method parity | 23–24 |

---

## 7. Benchmarking & Performance Measurement

### 7.1 Metrics

| Metric | Tool | What It Measures |
|--------|------|------------------|
| Heap object count | `bun:jsc` `heapStats().objectCount` | Total live JS objects — primary GC pressure indicator |
| Heap size | `bun:jsc` `heapStats().heapSize` | JS heap bytes |
| RSS | `process.memoryUsage().rss` | Actual RAM used |
| GC pause | `bun --heap-prof` → Chrome DevTools | GC pause duration and frequency |
| Throughput | `Bun.nanoseconds()` | Operations per second |
| p99 latency | Latency histogram | Worst-case (GC spike indicator) |
| Native heap | `MIMALLOC_SHOW_STATS=1` | Non-JS memory |
| JIT recompiles | `bun:jsc` `numberOfDFGCompiles()` | Shape instability indicator |

### 7.2 Benchmark Harness

```typescript
import { heapStats } from 'bun:jsc'

interface BenchResult {
  name: string
  opsPerSec: number
  heapObjectsBefore: number
  heapObjectsAfter: number
  heapObjectsDelta: number
  heapSizeMB: number
  rssMB: number
  p50Us: number
  p99Us: number
}

async function bench(
  name: string,
  setup: () => void,
  fn: () => void,
  iterations = 10_000,
  warmup = 1_000,
): Promise<BenchResult> {
  setup()

  // Warmup — let JSC JIT compile
  for (let i = 0; i < warmup; i++) fn()

  // Force GC before measurement
  Bun.gc(true)
  await Bun.sleep(100)

  const heapBefore = heapStats()
  const latencies: number[] = []

  const start = Bun.nanoseconds()
  for (let i = 0; i < iterations; i++) {
    const t0 = Bun.nanoseconds()
    fn()
    latencies.push(Bun.nanoseconds() - t0)
  }
  const elapsed = Bun.nanoseconds() - start

  Bun.gc(true)
  await Bun.sleep(100)
  const heapAfter = heapStats()

  latencies.sort((a, b) => a - b)

  return {
    name,
    opsPerSec: Math.round((iterations / elapsed) * 1e9),
    heapObjectsBefore: heapBefore.objectCount,
    heapObjectsAfter: heapAfter.objectCount,
    heapObjectsDelta: heapAfter.objectCount - heapBefore.objectCount,
    heapSizeMB: +(heapAfter.heapSize / 1024 / 1024).toFixed(2),
    rssMB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(2),
    p50Us: +(latencies[Math.floor(latencies.length * 0.50)] / 1000).toFixed(2),
    p99Us: +(latencies[Math.floor(latencies.length * 0.99)] / 1000).toFixed(2),
  }
}
```

### 7.3 Standard Benchmark Scenarios

**Phase 1 (Numeric):**

| # | Scenario | Workload | Key Metric |
|---|----------|----------|------------|
| B1 | Struct creation | Create 100k `{x, y, z}` vs slab | heapObjectsDelta |
| B2 | Insert/remove churn | 10k insert+remove per frame | p99 latency |
| B3 | Iteration | for..of over 100k items | ops/sec |
| B4 | Filter chain | .filter().map().filter() vs .iter() | heap Δ |
| B5 | Temp allocation | 1k objects in function vs bump.scoped | GC pause |
| B6 | Vec growth | Array.push 100k vs vec.push 100k | RSS MB |
| B7 | Nested structs | 50k {pos:{x,y}, vel:{x,y}} vs inline struct | heapObjectsDelta |

**Phase 2 (String):**

| # | Scenario | Workload | Key Metric |
|---|----------|----------|------------|
| B8 | str:N write | 100k encode via setter | ops/sec |
| B9 | str:N equals | 100k byte compare (cached) | ops/sec vs JS === |
| B10 | str:N toUpperCase | 100k ASCII fast path | ops/sec vs JS method |
| B11 | string ref | 100k JS string ref read/write | GC objects vs plain JS |
| B12 | Mixed str:N + string | 100k items, filter by str:N, display string | end-to-end |

### 7.4 Expected Results

**Phase 1:**

| Scenario | Plain JS | RigidJS | Improvement |
|----------|----------|---------|-------------|
| B1 heap objects | +100,000 | +1 | 99.999% fewer |
| B2 p99 latency | 50–200ms | <1ms | ~99% lower |
| B3 iteration | baseline | 1.5–3x faster | Cache-friendly |
| B4 heap Δ | +3 arrays | +0 | 100% fewer |
| B5 GC after fn | ~2ms | ~0ms | Deterministic |
| B6 RSS | ~50MB | ~1.6MB | ~97% less |
| B7 objects per entity | 3 | 0 | 100% fewer |

**Phase 2:**

| Scenario | Plain JS | RigidJS | Improvement |
|----------|----------|---------|-------------|
| B8 str:N write | N/A | ~80ns/write | Baseline for str:N |
| B9 str:N equals (cached) | ~10ns (===) | ~10ns (memcmp) | Comparable, but zero GC |
| B10 str:N toUpperCase ASCII | ~50ns | ~5ns/char | ~10x faster (byte ops) |
| B11 string ref GC | 200k objects | 100k + 1 | 50% fewer GC objects |
| B12 mixed end-to-end | 300k GC objects | 1–100k | 67–99.9% fewer |

### 7.5 Correctness Testing

```typescript
import { describe, expect, it } from 'bun:test'

describe('slab', () => {
  it('insert and read back same values', () => {
    const S = struct({ x: 'f64', y: 'f64' })
    const s = slab(S, 100)
    const h = s.insert()
    h.x = 42.5; h.y = -99.1
    expect(h.x).toBe(42.5)
    expect(h.y).toBe(-99.1)
    s.drop()
  })

  it('remove makes slot reusable', () => {
    const S = struct({ val: 'u32' })
    const s = slab(S, 2)
    const a = s.insert(); a.val = 1
    const b = s.insert(); b.val = 2
    s.remove(a)
    const c = s.insert(); c.val = 3
    expect(s.len).toBe(2)
    s.drop()
  })

  it('throws on use after drop', () => {
    const S = struct({ x: 'f64' })
    const s = slab(S, 10)
    s.drop()
    expect(() => s.insert()).toThrow()
  })

  it('iter skips removed slots', () => {
    const S = struct({ id: 'u32' })
    const s = slab(S, 5)
    const a = s.insert(); a.id = 1
    const b = s.insert(); b.id = 2
    const c = s.insert(); c.id = 3
    s.remove(b)
    const ids = s.iter().map(h => h.id).collect()
    expect(ids).toEqual([1, 3])
    s.drop()
  })
})

describe('str:N (Phase 2)', () => {
  it('write and read string', () => {
    const S = struct({ name: 'str:16' })
    const s = slab(S, 10)
    const h = s.insert()
    h.name = 'Thada'
    expect(h.name.toString()).toBe('Thada')
    s.drop()
  })

  it('equals with byte compare', () => {
    const S = struct({ status: 'str:8' })
    const s = slab(S, 10)
    const h = s.insert()
    h.status = 'active'
    expect(h.status.equals('active')).toBe(true)
    expect(h.status.equals('banned')).toBe(false)
    s.drop()
  })

  it('throws on overflow by default', () => {
    const S = struct({ code: 'str:4' })
    const s = slab(S, 10)
    const h = s.insert()
    expect(() => { h.code = 'toolong' }).toThrow()
    s.drop()
  })

  it('toUpperCase returns Str for chaining', () => {
    const S = struct({ tag: 'str:8' })
    const s = slab(S, 10)
    const h = s.insert()
    h.tag = 'hello'
    expect(h.tag.toUpperCase().equals('HELLO')).toBe(true)
    s.drop()
  })
})
```

### 7.6 CI Benchmark Gate

```yaml
name: Benchmark Gate
on: [pull_request]
jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run bench/run.ts
      - run: bun run bench/check-regression.ts --threshold 5
```

---

## 8. Limitations & Non-Goals

| Non-goal | Reason |
|----------|--------|
| Browser support | Bun-first. Browser is not a target for v1. |
| SharedArrayBuffer | Multi-threaded complexity too high for v1. |
| Auto-migration from plain JS | RigidJS is opt-in. No compiler transforms. |
| Arbitrary nested JS objects in struct | Only numeric types, str:N, and string refs. |
| String fields with no max length in ArrayBuffer | Use `string` (JS ref) for unlimited length. |

---

## 9. Future Exploration (Post-Phase 2)

- **SharedArrayBuffer** — Share slab/vec between Worker threads.
- **`bun:ffi` offload** — Compile hot `.iter()` chains to C via `cc()`.
- **`Bun.mmap()` integration** — Memory-mapped file-backed containers.
- **SIMD column ops** — Bulk math on entire columns (e.g., `slab.addColumn('pos.x', 'vel.x')`).
- **CLI checker** — `rigidjs check src/` to detect hot paths that would benefit from RigidJS.
- **TypeBox bridge** — `struct.fromTypeBox(schema)` for ecosystem integration.
- **SoA layout option** — `slab(T, n, { layout: 'soa' })` for column-oriented access patterns.

---

## 10. References

**Rust equivalents:**
- `slab` crate — https://docs.rs/slab
- `bumpalo` crate — https://docs.rs/bumpalo
- `Vec<T>` — https://doc.rust-lang.org/std/vec/struct.Vec.html
- `Drop` trait — https://doc.rust-lang.org/std/ops/trait.Drop.html
- `heapless::String<N>` — https://docs.rs/heapless
- `arrayvec::ArrayString<CAP>` — https://docs.rs/arrayvec

**Prior art (JS):**
- structurae — https://github.com/zandaqo/structurae
- bitECS — https://bitecs.dev
- typed-struct — https://www.npmjs.com/package/typed-struct

**Bun APIs:**
- bun:jsc module — https://bun.com/reference/bun/jsc
- Memory leak debugging — https://bun.com/blog/debugging-memory-leaks
- bun:ffi — https://bun.com/docs/runtime/ffi
- Bun.mmap() — https://bun.com/reference/bun/mmap

**Performance references:**
- Trigger.dev Bun optimization — https://trigger.dev/blog/firebun
- web.dev: Static Memory with Object Pools — https://web.dev/articles/speed-static-mem-pools
- Elysia JIT compiler — https://elysiajs.com/internal/jit-compiler
