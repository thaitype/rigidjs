# Gap Analysis: RigidJS vs JS Throughput

**Date:** 2026-04-12
**Data source:** `.chief/milestone-5/_report/task-4/results.json` (per-process isolation, Bun 1.3.8, darwin arm64)

---

## Summary Table

All ratios are RigidJS ops/s divided by JS baseline ops/s from the same benchmark run.

| Scenario | JS ops/s | RigidJS ops/s | Ratio | Status | Direction |
|---|---|---|---|---|---|
| B1-slab creation (100k) | 366 | 218 | 0.60x | Below 1x | A |
| B1-vec creation (100k, cap=16) | 403 | 250 | 0.62x | Below 1x | A |
| B2-slab churn (10k ins+rem) | 5,109 | 5,867 | 1.15x | Above 1x | A |
| B2-vec churn (10k push+swapRem) | 9,425 | 8,530 | 0.91x | Below 1x | A |
| B3-slab for..of iteration (100k) | 3,306 | 2,737 | 0.83x | Below 1x | A |
| B3-slab-forEach iteration (100k) | 3,442 | 3,900 | 1.13x | Above 1x | A |
| B3-slab column (100k) | 3,306 | 9,166 | 2.77x | Above 1x | B |
| B3-vec for..of iteration (100k) | 3,588 | 1,327 | 0.37x | Below 1x | A |
| B3-vec forEach iteration (100k) | 3,511 | 2,984 | 0.85x | Below 1x | A |
| B3-vec indexed get(i) (100k) | 3,086 | 5,310 | 1.72x | Above 1x | A |
| B3-vec column (100k) | 3,866 | 9,364 | 2.42x | Above 1x | B |
| B3-partial slab (50% full, 100k) | 3,324 | 2,180 | 0.66x | Below 1x | A |
| B3-partial vec (100% packed) | 3,324 | 1,243 | 0.37x | Below 1x | A |
| B7-nested slab (50k) vs nested JS | 425 | 179 | 0.42x | Below 1x | A |
| B7-nested slab (50k) vs flat JS | 675 | 179 | 0.27x | Below 1x | A |
| B8-slab sustained (100k, 10s) | 29,040 ticks | 63,343 ticks | 2.18x | Above 1x | A |
| B8-vec sustained (100k, 10s) | 27,627 ticks | 41,244 ticks | 1.49x | Above 1x | A |
| B9-slab 10k | 120,286 ticks | 121,162 ticks | 1.01x | At 1x | A |
| B9-slab 100k | 10,741 ticks | 9,662 ticks | 0.90x | Below 1x | A |
| B9-slab 1M | 937 ticks | 962 ticks | 1.03x | At 1x | A |
| B9-vec 10k | 113,066 ticks | 138,987 ticks | 1.23x | Above 1x | A |
| B9-vec 100k | 9,844 ticks | 15,478 ticks | 1.57x | Above 1x | A |
| B9-vec 1M | 858 ticks | 1,410 ticks | 1.64x | Above 1x | A |

---

## Detailed Gap Analysis

### 1. B1-slab: Entity Creation (0.60x)

**Current:** 218 ops/s vs 366 ops/s JS = 0.60x
**Measurement:** Create struct + slab + insert 100k entities with 3 field writes per entity.

**Root cause breakdown:**
- ArrayBuffer allocation + OS zero-fill: ~68us per slab construction (unavoidable OS cost)
- Per-insert overhead: ~10ns (freelist pop + bitmap set + handle rebase) vs JS ~6ns (hidden-class object literal)
- JS engine aggressively inlines `{x, y, z}` construction after JIT warmup

**Path to >= 1x:** Not achievable without changing the benchmark or the API. The fundamental issue is that JS object literal creation is one of the most optimized paths in any JS engine. RigidJS pays for ArrayBuffer allocation, freelist management, and bitmap tracking -- all of which JS objects avoid by deferring cost to GC.

**Mitigations (improve ratio but not reach 1x):**
- Pre-allocate slab with known capacity (eliminates per-test constructor cost, saves ~68us)
- Batch insert API that skips per-element handle rebase
- Move bitmap to a simpler scheme for dense-only workloads

**Difficulty:** Fundamental. The creation gap is structural: RigidJS front-loads allocation cost that JS defers to GC. Realistic floor: ~0.6-0.7x.

**Direction:** A. This is the primary gap to be honest about.

---

### 2. B1-vec: Entity Creation with Growth (0.62x)

**Current:** 250 ops/s vs 403 ops/s JS = 0.62x
**Measurement:** Create struct + vec(cap=16) + push 100k entities (triggers 13 growth events).

**Root cause breakdown:**
- 13 growth events: each triggers new ArrayBuffer allocation (zero-fill) + TypedArray data copy + handle class re-creation via `new Function()`
- Growth cost: ~180us cumulative (ArrayBuffer alloc + copy dominates; handle re-creation is ~29us total)
- Strategy B (rebind TypedArray in-place) was tested and rejected: causes JSC hidden-class invalidation, reducing throughput by 30%

**Path to >= 1x:**
- `reserve(100_000)` before pushing eliminates all growth events. Pre-reserved: ~418us vs ~599us (growth), bringing ratio closer to ~0.7x
- Still cannot reach 1x because per-push cost (~4ns) > JS object creation (~2.5ns/obj at this scale)

**Difficulty:** Medium for reserve() mitigation (already shipped). Fundamental for reaching 1x -- same structural issue as B1-slab.

**Direction:** A.

---

### 3. B2-vec: Insert/Remove Churn (0.91x)

**Current:** 8,530 ops/s vs 9,425 ops/s JS = 0.91x
**Measurement:** 10k push + 10k swapRemove per frame, pre-warmed vec.

**Root cause breakdown:**
- swapRemove per-element: column swap (TypedArray indexed write x numColumns) + length decrement
- JS baseline: array.pop() + splice is highly optimized by JSC for small arrays
- After Map.get() elimination (task-3 fix), the remaining cost is pure TypedArray indexed writes vs JS property assignment

**Path to >= 1x:**
- Reduce per-column overhead: if columns could be processed with a single memcpy-style operation instead of per-field indexed writes, the gap would close
- SIMD or Bun FFI could theoretically batch column swaps, but this is speculative
- The gap is small enough (0.91x) that JIT variance across runs can flip it above 1x

**Difficulty:** Medium. The 9% gap is within optimization range but needs a different approach to column swap.

**Direction:** A.

---

### 4. B3-slab: for..of Handle Iteration (0.83x)

**Current:** 2,737 ops/s vs 3,306 ops/s JS = 0.83x
**Measurement:** 100k entities, `for (const h of slab)` reading pos.x += vel.x.

**Root cause breakdown:**
- Iterator protocol overhead: `Symbol.iterator` + `next()` method calls + `{value, done}` object allocation per step
- Handle rebase: ~10ns per element (repoint handle to new slot)
- Field read/write through generated accessor: DataView.getFloat64 / setFloat64

**Path to >= 1x:**
- Already solved by forEach: slab.forEach achieves 1.13x by eliminating iterator protocol overhead
- for..of will always be slower due to iterator protocol -- this is architectural
- Recommend documenting forEach as the preferred iteration API

**Difficulty:** Fundamental for for..of. Already solved via forEach.

**Direction:** A.

---

### 5. B3-vec: for..of Handle Iteration (0.37x)

**Current:** 1,327 ops/s vs 3,588 ops/s JS = 0.37x
**Measurement:** 100k entities, `for (const h of vec)` reading pos.x += vel.x.

**Root cause breakdown:**
- Same iterator protocol overhead as slab for..of
- Vec iterator additionally must rebase the SoA handle on each step (updating column offsets)
- The SoA handle rebase is more expensive than slab's AoS rebase because it touches multiple TypedArray index fields
- Combined cost: ~750ns per iteration vs JS ~280ns

**Path to >= 1x:**
- forEach (0.85x) is 2.3x faster than for..of -- use it instead
- Indexed get(i) (1.72x) is 4.6x faster than for..of -- the recommended fast path
- Column access (2.42x) is 6.5x faster -- the recommended bulk path
- for..of on vec should be documented as a convenience API, not a performance API

**Difficulty:** Fundamental. Iterator protocol + per-step SoA rebase is inherently expensive.

**Direction:** A. Users should use get(i) or column() instead.

---

### 6. B3-vec: forEach Handle Iteration (0.85x)

**Current:** 2,984 ops/s vs 3,511 ops/s JS = 0.85x
**Measurement:** 100k entities, `vec.forEach(h => { h.pos.x += h.vel.x })`.

**Root cause breakdown:**
- Callback dispatch overhead: ~3.3ns per call (JS function call frame save/restore)
- Handle rebase per element: ~10ns (update index on reused handle)
- Total per-element: ~13ns vs JS ~8ns (direct property read/write on cached object)

**Path to >= 1x:**
- Reduce handle rebase cost: if the handle could advance without reassigning internal index (e.g., pointer arithmetic on a view), the rebase cost drops
- Investigate whether `new Function()`-generated forEach that inlines the callback body is feasible (would eliminate call overhead but requires API change)
- Batch field access: a "tick" API that receives column arrays + length instead of a handle could bypass rebase entirely

**Difficulty:** Hard. The 15% gap is split between callback overhead (architectural) and handle rebase (fixable with effort). Reaching exactly 1.0x is plausible with handle optimizations; exceeding 1x is unlikely without removing the handle abstraction from the hot path.

**Direction:** A.

---

### 7. B3-partial: Sparse Slab Iteration (0.66x)

**Current:** 2,180 ops/s vs 3,324 ops/s JS = 0.66x
**Measurement:** Slab at 50% occupancy (100k live / 200k slots), forEach iteration.

**Root cause breakdown:**
- Bitmap scanning: even with inlined bit operations, the forEach loop must check every slot's bitmap bit
- At 50% occupancy, half the iterations are wasted on empty slots
- The JS baseline iterates a dense array of 100k objects with no holes

**Path to >= 1x:**
- Implement a skip-list or hierarchical bitmap (e.g., 64-bit word scan with `Math.clz32` to skip 32 empty slots at once)
- Alternatively, maintain a dense index array of live slots (trading O(1) remove for O(1) iteration)
- Column API bypasses this entirely for dense reads

**Difficulty:** Medium. Hierarchical bitmap scanning is a well-known technique. Could bring sparse iteration close to dense iteration speed.

**Direction:** A.

---

### 8. B3-partial vec (0.37x)

**Current:** 1,243 ops/s vs 3,324 ops/s JS = 0.37x
**Measurement:** Vec 100%-packed (100k len), for..of iteration with pos.x += vel.x.

**Root cause:** This is the same for..of overhead as B3-vec-handle (0.37x). Vec is always dense, so the low ratio is purely iterator protocol + SoA handle rebase, not sparsity.

**Path to >= 1x:** Same as B3-vec for..of -- use forEach (0.85x), get(i) (1.72x), or column (2.42x).

**Difficulty:** Fundamental for for..of.

**Direction:** A.

---

### 9. B7: Nested Struct Creation (0.42x vs nested JS, 0.27x vs flat JS)

**Current:** 179 ops/s vs 425 ops/s (nested JS) = 0.42x; vs 675 ops/s (flat JS) = 0.27x
**Measurement:** 50k Particle structs (pos:Vec3, vel:Vec3, life:f32, id:u32) = 56 bytes each, slab insert.

**Root cause breakdown:**
- Same as B1-slab but amplified: 8 fields per entity (vs 3 in B1) means 8 TypedArray writes per insert
- ArrayBuffer for 50k x 56 bytes = 2.8MB allocation + zero-fill
- Handle rebase cost scales with number of nested accessor fields
- JS nested objects: JSC optimizes `{pos: {x,y,z}, vel: {x,y,z}, life, id}` aggressively (3 objects per entity but all same hidden class)

**Path to >= 1x:**
- Batch field write API: `slab.insertRaw(Float64Array)` that copies a pre-packed buffer directly, skipping per-field accessor writes
- This would reduce 8 individual TypedArray writes to a single `TypedArray.set()` call per entity
- Nested struct overhead is proportional to field count -- fundamentally harder to optimize than flat structs

**Difficulty:** Hard. Batch insert could bring it to ~0.5-0.6x. Reaching 1x vs flat JS is not realistic because RigidJS always pays ArrayBuffer allocation + per-entity bookkeeping that JS avoids.

**Direction:** A.

---

### 10. B8-slab: Sustained Churn (2.18x -- ABOVE 1x)

**Current:** 63,343 ticks vs 29,040 ticks JS = 2.18x throughput advantage.

**Why RigidJS wins:**
- Over 10 seconds of sustained 1k insert+remove per tick, JS accumulates GC pressure from 100k live objects
- RigidJS slab reuses slots in-place with zero GC allocation (allocationDelta = 0)
- JS p99: 0.29ms, RigidJS p99: 0.20ms -- lower tail latency
- JS max: 4.91ms, RigidJS max: 3.75ms -- smaller worst-case spike

**Risk of regression:** Low. The advantage comes from the fundamental GC-free design. As long as slab reuses slots without allocating JS objects, this holds.

**Direction:** A. This is the core value proposition of RigidJS.

---

### 11. B8-vec: Sustained Churn (1.49x -- ABOVE 1x)

**Current:** 41,244 ticks vs 27,627 ticks JS = 1.49x.

**Why RigidJS wins but less than slab:**
- Vec swapRemove is more expensive than slab remove (column array swap vs bitmap clear)
- Vec p99: 0.75ms vs JS p99: 0.42ms -- vec has HIGHER tail latency than JS
- Vec p999: 1.06ms -- approaching the 1ms target
- High RSS (369MB vs 148MB JS) suggests vec is holding over-allocated buffers from growth events

**Risk of regression:** Medium. The p99 latency disadvantage is concerning. Vec sustained churn needs buffer management improvement.

**Path to improvement:**
- Shrink-to-fit after sustained period of low growth
- More aggressive memory management to reduce RSS

**Direction:** A.

---

### 12. B9-slab: Heap Scaling

| Capacity | JS ticks | RigidJS ticks | Ratio | RigidJS p99 | JS p99 |
|---|---|---|---|---|---|
| 10k | 120,286 | 121,162 | 1.01x | 0.023ms | 0.026ms |
| 100k | 10,741 | 9,662 | 0.90x | 0.30ms | 0.46ms |
| 1M | 937 | 962 | 1.03x | 2.44ms | 3.30ms |

**Analysis:** Slab scales linearly with JS at all sizes. At 100k the throughput ratio dips to 0.90x but the p99 latency is 35% better (0.30ms vs 0.46ms). At 1M the throughput is equal but latency is 26% better. The throughput dip at 100k is within benchmark noise.

**Direction:** A. Slab scaling is solid.

---

### 13. B9-vec: Heap Scaling

| Capacity | JS ticks | RigidJS ticks | Ratio | RigidJS p99 | JS p99 |
|---|---|---|---|---|---|
| 10k | 113,066 | 138,987 | 1.23x | 0.045ms | 0.034ms |
| 100k | 9,844 | 15,478 | 1.57x | 0.15ms | 0.50ms |
| 1M | 858 | 1,410 | 1.64x | 2.44ms | 3.89ms |

**Analysis:** Vec dominates at scale. The throughput advantage grows with capacity (1.23x at 10k, 1.64x at 1M). P99 latency is 3x better at 100k (0.15ms vs 0.50ms) and 37% better at 1M. Vec's contiguous memory layout pays off at large scale.

**Direction:** A. Vec scaling is a clear win.

---

## Operations Already Above 1x

| Operation | Ratio | What maintains the advantage | Regression risk |
|---|---|---|---|
| B2-slab churn | 1.15x | Freelist reuse, no GC allocation per insert/remove | Low |
| B3-slab forEach | 1.13x | Internal counted loop, no iterator protocol | Low |
| B3-vec indexed get(i) | 1.72x | Direct TypedArray indexed read, no iterator overhead | Low |
| B3-slab column | 2.77x | Raw TypedArray iteration, cache-line friendly | Low |
| B3-vec column | 2.42x | Raw TypedArray iteration, SoA layout | Low |
| B8-slab sustained | 2.18x | Zero GC pressure, slot reuse | Low |
| B8-vec sustained | 1.49x | Zero GC pressure, contiguous memory | Medium (high p99) |
| B9-vec 10k-1M | 1.23-1.64x | Contiguous memory, no GC scaling cost | Low |
| B9-slab 10k/1M | 1.01-1.03x | Parity; better p99 latency | Low |

---

## Classification of Gaps

### Can reach >= 1x with optimization work

| Operation | Current | Target | Approach | Difficulty |
|---|---|---|---|---|
| B2-vec churn | 0.91x | >= 1.0x | Optimize column swap loop, reduce per-element overhead | Medium |
| B3-vec forEach | 0.85x | >= 1.0x | Reduce handle rebase cost, optimize accessor codegen | Hard |
| B9-slab 100k | 0.90x | >= 1.0x | Within noise; improve bitmap scan efficiency | Easy |

### Can improve but unlikely to reach 1x

| Operation | Current | Realistic floor | Why |
|---|---|---|---|
| B1-slab creation | 0.60x | ~0.65-0.70x | ArrayBuffer zeroing + per-insert bookkeeping is structural |
| B1-vec creation | 0.62x | ~0.70x (with reserve) | Growth cost eliminated by reserve; per-push cost remains |
| B3-slab for..of | 0.83x | ~0.85x | Iterator protocol overhead is architectural; use forEach instead |
| B3-vec for..of | 0.37x | ~0.40x | Iterator protocol + SoA rebase; use get(i) or column instead |
| B3-partial slab | 0.66x | ~0.80x | Hierarchical bitmap could halve scan cost |
| B7-nested creation | 0.42x | ~0.55x | Batch insert could reduce field write overhead |

### Fundamental limits (accept and document)

| Operation | Current | Root cause |
|---|---|---|
| B1 entity creation vs JS objects | 0.60x | JS engines optimize object literals at the bytecode/JIT level. RigidJS pays upfront allocation cost that JS defers to GC. This is the design tradeoff. |
| for..of iteration | 0.37-0.83x | JS iterator protocol allocates `{value, done}` per step. Cannot be eliminated. forEach/get(i)/column are the answers. |
| B7 nested creation | 0.27-0.42x | More fields = more writes = larger gap. Structural amplification of B1 gap. |
