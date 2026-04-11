# RigidJS Phase 1 Benchmark Results & Improvement Suggestions

## 1. Executive Summary

Phase 1 benchmarks reveal a clear split result: RigidJS achieves its primary goal of reducing GC pressure (~318x fewer tracked objects) but loses on raw throughput (2.6–6.2x slower per-operation). This report analyzes the root cause and proposes concrete improvements.

### Key Findings

| Metric | Plain JS | RigidJS | Winner |
|--------|----------|---------|--------|
| B1 GC objects (100k items) | 100,106 | 315 | **RigidJS ~318x fewer** |
| B7 GC objects (nested 50k) | 150,092 | 491 | **RigidJS ~306x fewer** |
| B1 ops/sec (create 100k) | 558 | 213 | JS 2.6x faster |
| B2 ops/sec (insert/remove churn) | 6,428 | 2,450 | JS 2.6x faster |
| B3 ops/sec (iteration + mutate) | 3,393 | 549 | JS 6.2x faster |
| B7 ops/sec (nested create) | 828–893 | 254 | JS 3.3x faster |

**The GC reduction is real and significant. The throughput loss is also real and needs addressing.**

---

## 2. Root Cause Analysis

### 2.1 Why Plain JS Object Access is Fast

JS engines (V8's TurboFan, JSC's FTL) have spent 15+ years optimizing plain object property access through two key mechanisms:

**Hidden Classes (V8: Maps, JSC: Structures)**

When objects share the same shape (same properties in same order), the engine assigns them a shared hidden class. This hidden class records the byte offset of each property, transforming dynamic property lookup into a fixed-offset memory read — essentially identical to C struct access.

```
// After JIT optimization, p.x compiles to:
mov eax, [object_ptr + 16]    // single machine instruction, ~1ns
```

**Inline Caching**

The JIT records which hidden class was seen at each property access site. On subsequent calls, it skips the lookup entirely and reads from the cached offset. For monomorphic (single-shape) access patterns, this achieves near-native speed.

The combination means: **plain JS `p.x` after JIT warmup ≈ 1 machine instruction ≈ ~1–3ns**.

### 2.2 Why DataView Access is Slower

RigidJS currently uses `DataView.getFloat64(offset)` for field access. Even after engine optimizations, this has inherent overhead:

```
// DataView access compiles to:
call DataView.getFloat64     // function call (even if inlined by JIT)
  → validate ArrayBuffer not detached
  → bounds check (offset + 8 <= byteLength)
  → read bytes
  → handle endianness
  → return value
// Total: ~3–8ns depending on engine/JIT tier
```

V8 has optimized DataView significantly (matching TypedArray in their 2018 blog post), but JSC (used by Bun) may not have the same level of DataView JIT inlining. No public documentation confirms JSC optimizes DataView to the same degree.

**Critical insight: The performance gap is not "ArrayBuffer vs objects" — it's "DataView dispatch vs JIT-inlined property access."**

### 2.3 Handle Object Allocation in Iteration

The current iterator creates a Handle object per iteration step:

```ts
for (const p of particles) {    // each iteration: new Handle(view, offset)
  p.x += p.vx                   // handle.get x() → view.getFloat64(off + 0)
}
```

This creates N temporary Handle objects per loop, reintroducing GC pressure in the exact hot path RigidJS is designed to optimize.

---

## 3. Proposed Improvements

### 3.1 Switch from AoS + DataView to SoA + TypedArray

**Priority: Critical — Expected impact: 3–6x throughput improvement**

**Current (AoS — Array of Structs):**

```
1 ArrayBuffer, mixed types, DataView access:
Memory: [x₀,y₀,id₀] [x₁,y₁,id₁] [x₂,y₂,id₂] ...
Access: view.getFloat64(index * stride + fieldOffset)   // DataView call
```

**Proposed (SoA — Struct of Arrays):**

```
Separate TypedArray per field:
xs:  Float64Array [x₀, x₁, x₂, ...]
ys:  Float64Array [y₀, y₁, y₂, ...]
ids: Uint32Array  [id₀, id₁, id₂, ...]
Access: this.xs[index]                                  // TypedArray indexed access
```

**Why this is faster:**

TypedArray indexed access (`arr[i]`) is treated by JIT compilers the same as regular array access — it compiles down to a single memory load instruction with bounds check. Engines have heavily optimized this path because asm.js and WebAssembly depend on it.

```
// TypedArray access after JIT:
cmp index, arrayLength         // bounds check (often eliminated by JIT)
mov eax, [arrayBase + index*8] // single memory load, ~1–2ns
```

**API does not change:**

```ts
// User code remains identical
const p = particles.insert()
p.x = 10                        // setter → this.xs[this.idx] = 10
console.log(p.x)                // getter → return this.xs[this.idx]
```

Only the generated Handle class changes internally:

```ts
// Before (DataView):
class Handle {
  get x() { return this.view.getFloat64(this.off + 0) }
}

// After (SoA + TypedArray):
class Handle {
  get x() { return this.xs[this.idx] }
}
```

**Additional SoA benefits:**

- Cache-friendly sequential access when iterating a single field across all items
- SIMD-friendly layout for future bulk operations
- Each TypedArray can be passed directly to WebGL, WASM, or `bun:ffi`

**SoA trade-offs:**

- Accessing all fields of one item touches multiple arrays (cache miss per field)
- Cannot export the entire struct as a single binary blob (unlike AoS)
- Slightly more memory bookkeeping (one TypedArray per field vs one DataView)

### 3.2 Reuse Handle Object in Iteration

**Priority: High — Expected impact: reduce GC pressure during iteration to zero**

Instead of creating a new Handle per iteration, reuse a single Handle and update its index:

```ts
// Before: new Handle each iteration
for (const p of particles) {         // new Handle(view, offset) per step
  p.x += 1
}

// After: reuse single Handle, update index
const handle = particles._handle     // pre-allocated, reused
for (let i = 0; i < particles.len; i++) {
  handle._idx = i                    // just update index, no allocation
  handle.x += 1
}
```

The `for...of` iterator should internally reuse the same handle object:

```ts
// Iterator implementation
*[Symbol.iterator]() {
  const handle = this._reusableHandle
  for (let i = 0; i < this.capacity; i++) {
    if (!this.isOccupied(i)) continue
    handle._idx = i                   // reuse, don't allocate
    yield handle
  }
}
```

**Caveat:** Users must not store references to yielded handles across iterations, as the handle mutates. This is the same pattern as Rust's `iter()` which borrows — the yielded reference is only valid for the current iteration. Document this clearly.

### 3.3 Provide Direct Column Access for Hot Loops

**Priority: Medium — Expected impact: maximum throughput for bulk operations**

For the absolute fastest iteration, expose raw TypedArray columns:

```ts
// Direct column access — zero Handle overhead
const xs = particles.column('x')    // returns Float64Array
const vxs = particles.column('vx')  // returns Float64Array

for (let i = 0; i < n; i++) {
  xs[i] += vxs[i]                   // pure TypedArray, JIT loves this
}
```

This bypasses the Handle entirely. The JIT can optimize this into a tight loop with potential auto-vectorization.

**Relationship to existing API:**

```
API Level        Convenience    Speed        Use Case
─────────────    ───────────    ─────────    ──────────────────────
p.x = 10         High           Good         General use, readability
for (const p)    High           Good         Iteration with handle reuse
.iter().filter() High           Good         Query chains
.column('x')     Low            Maximum      Hot inner loops, bulk math
```

Users choose the level that fits their performance needs.

### 3.4 Codegen Optimization — Monomorphic TypedArray Access

**Priority: Medium — Expected impact: ensure JIT produces optimal code**

Ensure generated getter/setter code is monomorphic (always the same TypedArray type at each access site):

```ts
// Good: monomorphic — JIT sees Float64Array every time
class ParticleHandle {
  private xs: Float64Array    // always Float64Array
  get x() { return this.xs[this.idx] }
}

// Bad: polymorphic — JIT sees different array types
class ParticleHandle {
  private arrays: TypedArray[]  // could be Float64Array, Uint32Array, ...
  get x() { return this.arrays[0][this.idx] }   // JIT can't specialize
}
```

Each field's getter/setter should reference its specific TypedArray directly, not through an indirection layer. The codegen already does this for DataView — just switch the target to TypedArray.

### 3.5 Benchmark Harness Correction

**Priority: High — Required for accurate measurement**

The finding that `heapStats().objectCount` is stale (only refreshed during GC) is important. The corrected approach:

```ts
// Before (inaccurate):
const delta = heapStats().objectCount  // stale cached value

// After (accurate):
const counts = heapStats().objectTypeCounts
const total = Object.values(counts).reduce((a, b) => a + b, 0)
```

Update all benchmarks to use `objectTypeCounts` sum as the primary GC pressure metric.

---

## 4. Estimated Impact

### Before (Current: AoS + DataView + Handle-per-iter)

| Bottleneck | Cost |
|-----------|------|
| DataView dispatch per field access | ~5–8ns vs ~1–3ns for JS property |
| Handle allocation per iteration | N objects created per loop |
| Non-monomorphic DataView calls | JIT cannot fully specialize |
| **Overall throughput** | **2.6–6.2x slower than plain JS** |

### After (Proposed: SoA + TypedArray + Handle reuse)

| Improvement | Expected Effect |
|------------|----------------|
| TypedArray indexed access | ~1–2ns per field (matches JS property access) |
| Handle reuse in iterator | 0 allocations per loop iteration |
| Monomorphic codegen | JIT fully specializes each getter/setter |
| Column access for hot loops | Pure TypedArray loop, potential auto-vectorization |
| **Expected throughput** | **0.8–1.2x vs plain JS (within margin)** |

### GC Metrics (Unchanged)

The GC object count improvement (~318x fewer) is already achieved and will be maintained. SoA uses multiple TypedArrays instead of one ArrayBuffer, but the count is still proportional to the number of fields (typically < 10), not the number of items (100k+).

```
AoS: 1 ArrayBuffer + 1 DataView = 2 GC objects
SoA: 8 TypedArrays (for 8 fields) = 8 GC objects

Both: massively better than 100k+ plain JS objects
```

---

## 5. Implementation Priority

| # | Change | Effort | Impact | Risk |
|---|--------|--------|--------|------|
| 1 | SoA + TypedArray layout | Medium | Critical (3–6x throughput) | Low — API unchanged |
| 2 | Handle reuse in iterator | Low | High (zero iter allocation) | Medium — users must not store handles |
| 3 | Fix benchmark harness (objectTypeCounts) | Low | Required (accurate data) | None |
| 4 | Column access API | Low | Medium (max hot loop speed) | None — additive API |
| 5 | Monomorphic codegen audit | Low | Medium (JIT friendliness) | None |

Recommended order: 3 → 1 → 2 → 5 → 4

Fix measurement first, then address the biggest bottleneck (DataView → TypedArray), then eliminate iterator allocation, then polish.

---

## 6. Revised Value Proposition

The original thesis stands, but with a nuance:

> ~~"RigidJS makes your code faster"~~
>
> **"RigidJS makes your app stop pausing — and with SoA, matches plain JS throughput too."**

At 100k items in a single burst, JSC's young-gen GC handles JS objects fine. At 10M items over minutes, or 100k items × 60 frames/sec sustained, GC scan cost is proportional to heap object count — that's where the 318x reduction pays off as elimination of GC pauses.

With SoA + TypedArray, throughput should reach parity with plain JS objects, giving users the best of both worlds: **zero GC pauses AND competitive per-operation speed**.

---

## 7. References

- V8 DataView optimization (2018): https://v8.dev/blog/dataview
- V8 fast properties & hidden classes: https://v8.dev/blog/fast-properties
- V8 inline caching internals: https://mrale.ph/blog/2012/06/03/explaining-js-vms-in-js-inline-caches.html
- JSC Structure (hidden class equivalent): https://bun.com/blog/how-bun-supports-v8-apis-without-using-v8-part-2
- Bun/JSC vs V8 performance characteristics: https://medium.com/@kishorjena/why-bun-is-faster-then-nodejs-41c3658fe905
- TypedArray vs DataView use cases: https://hacks.mozilla.org/2017/01/typedarray-or-dataview-understanding-byte-order/
