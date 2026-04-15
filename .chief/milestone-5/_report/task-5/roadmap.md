# Roadmap: Achieving the End Goal

**End goal:** All operations >= 1x JS throughput + GC-free (Direction A) while maintaining 3-4x column advantage (Direction B).

**Honest assessment:** Not all operations can reach >= 1x. Entity creation (B1, B7) and for..of iteration are fundamentally limited by JS engine optimizations that RigidJS cannot match. The strategy is to (1) close gaps where possible, (2) provide faster alternative APIs where the default path is slow, and (3) document the tradeoffs honestly so users choose the right API for their workload.

---

## Current State After Milestone 5

**Already >= 1x:**
- Slab churn (1.15x), slab forEach (1.13x), vec indexed get (1.72x)
- Column iteration (2.42-2.77x)
- Sustained churn: slab (2.18x), vec (1.49x)
- Heap scaling: vec (1.23-1.64x), slab (~1.0x)

**Below 1x, closeable:**
- B2-vec churn (0.91x) -- 9% gap
- B3-vec forEach (0.85x) -- 15% gap
- B9-slab 100k (0.90x) -- 10% gap, likely noise

**Below 1x, structural:**
- B1 creation (0.60-0.62x) -- ArrayBuffer zeroing vs JS object literals
- for..of iteration (0.37-0.83x) -- iterator protocol overhead
- B7 nested creation (0.27-0.42x) -- amplified creation gap
- B3-partial sparse (0.66x) -- bitmap scan overhead

---

## Milestone 6: Close the Closeable Gaps

**Goal:** Get B2-vec churn and B3-vec forEach to >= 1x. Improve sparse slab iteration. Ship Phase 1 feature completeness.

**Expected outcome:** Every operation that can reach 1x does reach 1x. The only remaining gaps are creation (structural) and for..of (architectural).

### Key tasks

1. **Optimize vec swapRemove column swap** -- The remaining B2-vec gap (0.91x) is per-column TypedArray indexed writes. Investigate batching column swaps or reducing loop overhead. Target: >= 1.0x.

2. **Reduce vec forEach handle rebase cost** -- The B3-vec forEach gap (0.85x) is handle rebase (10ns) + callback dispatch (3.3ns). Investigate:
   - Pre-computed offset stride for sequential access (avoid per-element index calculation)
   - Whether the generated handle class can use a single incrementing offset instead of per-column index assignment
   - Target: >= 1.0x

3. **Hierarchical bitmap scanning for sparse slab** -- B3-partial (0.66x) scans every bit. Implement word-level scanning with `Math.clz32` to skip 32 empty slots at a time. Target: >= 0.80x.

4. **Ship `bump()` arena allocator** -- Phase 1 feature from the design spec. Bump allocation is O(1) pointer increment with no freelist or bitmap. Should be the fastest allocation path.

5. **Ship `.iter()` lazy chains** -- Phase 1 feature: `filter`, `map`, `take`, `reduce` on slab/vec iterators. These compose with forEach/column for ergonomic data processing.

**Dependencies:** None. All work is independent.

**Expected improvement:**
| Operation | Before | After |
|---|---|---|
| B2-vec churn | 0.91x | >= 1.0x |
| B3-vec forEach | 0.85x | >= 1.0x |
| B3-partial slab | 0.66x | ~0.80x |

---

## Milestone 7: Creation Gap Mitigation + GC Pressure Benchmarks

**Goal:** Reduce the creation gap as much as structurally possible. Add GC pressure benchmarks that demonstrate RigidJS's advantage in realistic scenarios.

**Expected outcome:** Creation ratio improves from 0.60x to ~0.70x. New benchmarks show that under GC pressure, RigidJS's upfront cost is amortized and JS's deferred cost becomes visible.

### Key tasks

1. **Batch insert API** -- `slab.insertBatch(data: Float64Array, count: number)` that copies pre-packed data directly into the ArrayBuffer with a single `TypedArray.set()` call per column. Bypasses per-entity handle rebase and per-field accessor writes. Target: >= 0.70x for B1-slab.

2. **GC pressure benchmark (B10)** -- New scenario: run entity creation + sustained churn simultaneously, with periodic forced GC. Measure total time including GC pauses. In this scenario RigidJS should show its advantage because JS's deferred allocation cost becomes visible as GC pauses.

3. **Reserve-aware B1-vec variant** -- Add a B1-vec-reserved scenario that calls `reserve(100_000)` before pushing. This shows the realistic usage pattern where capacity is known. Target: ~0.70x (vs 0.62x without reserve).

4. **Optimize nested struct insert** -- For B7, batch field writes for nested structs by generating a single `DataView` write sequence instead of individual typed array writes per field. Target: ~0.55x (vs 0.42x).

**Dependencies:** Milestone 6 (bump allocator may inform batch insert design).

**Expected improvement:**
| Operation | Before | After |
|---|---|---|
| B1-slab creation | 0.60x | ~0.70x |
| B1-vec creation | 0.62x | ~0.70x (reserved) |
| B7-nested creation | 0.42x | ~0.55x |

---

## Milestone 8: Vec Memory Management + Tail Latency

**Goal:** Fix vec's high RSS and p99 latency in sustained workloads. Make vec's sustained churn as clean as slab's.

**Expected outcome:** B8-vec p99 drops below 0.5ms. RSS stays proportional to live data.

### Key tasks

1. **Shrink-to-fit for vec** -- After sustained low-growth periods, reallocate to a smaller buffer. Reduce RSS from 369MB to proportional to live data (~55MB for 100k entities).

2. **Growth strategy tuning** -- Current 2x growth is aggressive. Investigate 1.5x growth with larger initial capacity. Reduce over-allocation waste.

3. **Vec p99 latency investigation** -- B8-vec p99 (0.75ms) is higher than JS (0.42ms) despite higher throughput. Profile to determine if growth events during sustained churn cause latency spikes.

4. **Memory accounting API** -- `slab.memoryUsage()` / `vec.memoryUsage()` returning `{ allocated, used, overhead }` so users can monitor and tune.

**Dependencies:** None.

**Expected improvement:**
| Metric | Before | After |
|---|---|---|
| B8-vec p99 | 0.75ms | < 0.50ms |
| B8-vec RSS | 369MB | < 100MB |

---

## Milestone 9: Phase 2 -- String Support

**Goal:** Add `str:N` (fixed-length) and `string` (variable-length) field types per the design spec.

**Expected outcome:** RigidJS covers mixed numeric + text workloads (API servers, product catalogs, user data).

### Key tasks

1. **`str:N` fixed-length string field** -- Stored inline as N bytes UTF-8. Read/write via TextEncoder/TextDecoder.
2. **`string` variable-length string field** -- Stored as offset + length into a separate string buffer within the container.
3. **String benchmarks** -- Compare creation, iteration, and access patterns for string-heavy structs vs JS objects.
4. **String iteration via column API** -- Ensure column access returns a usable typed array or string array for bulk processing.

**Dependencies:** Milestone 6 (bump allocator useful for string buffer management).

---

## Milestone 10: Documentation + npm Publish

**Goal:** Ship RigidJS 0.1.0 to npm with documentation, examples, and honest benchmark results.

### Key tasks

1. **README with API reference** -- All public API symbols documented with examples.
2. **Performance guide** -- Document which API to use for each workload pattern:
   - Bulk numeric processing: column API (2.4-2.8x JS)
   - Game loop / ECS: forEach or get(i) (1.0-1.7x JS)
   - Creation-heavy: acknowledge 0.6-0.7x tradeoff, show amortization over sustained use
   - for..of: convenience only, not for hot paths
3. **Published benchmark results** -- Reproducible benchmark suite with per-process isolation.
4. **npm package** -- ESM-only, zero dependencies, Bun-first but Node-compatible.

---

## What Cannot Reach >= 1x (Honest Limits)

These operations are structurally limited. The roadmap does not target 1x for them.

### Entity creation (B1, B7): Floor ~0.65-0.70x

**Why:** JS engines compile `{x, y, z}` to a single hidden-class allocation + inline property writes. This is one of the most optimized paths in V8/JSC/SpiderMonkey. RigidJS pays: ArrayBuffer zero-fill (OS cost), freelist pop, bitmap set, handle rebase, and per-field TypedArray writes. Each of these is individually cheap (~1-10ns) but they add up to ~10ns/entity vs JS's ~6ns/entity.

**The tradeoff is by design:** RigidJS front-loads allocation cost so it never hits GC. In sustained workloads (B8), this pays off with 2x throughput and lower tail latency. The creation benchmark measures only the upfront cost without the GC payoff.

**User guidance:** If your workload creates entities once and processes them many times (game entities, simulations, sensor streams), the 0.6-0.7x creation cost is amortized over thousands of frames of 1.1-2.8x processing speed. If your workload is creation-dominated (ephemeral objects, request/response), use plain JS objects.

### for..of iteration: Floor ~0.37-0.85x

**Why:** The JS iterator protocol requires allocating a `{value, done}` object per `next()` call. Even with JIT escape analysis, this adds overhead that a simple `for` loop avoids. RigidJS's forEach eliminates this by using an internal counted loop.

**User guidance:** Use `forEach(cb)` for handle iteration (1.0-1.1x). Use `get(i)` for indexed access (1.7x). Use `column()` for bulk processing (2.4-2.8x). Reserve `for..of` for debugging and small collections.

### Sparse slab iteration: Floor ~0.80x

**Why:** Bitmap scanning has inherent overhead vs dense array iteration. Even with hierarchical bitmaps, checking occupancy bits adds cycles that dense arrays avoid.

**User guidance:** If iteration speed matters more than stable slot IDs, use vec (always dense). Slab is for stable handles with insert/remove churn; vec is for dense sequential processing.

---

## Direction A vs Direction B Summary

### Direction A: Predictable, GC-free large collections

| Category | Status | Milestone |
|---|---|---|
| Sustained churn throughput | Done (1.5-2.2x) | M5 |
| forEach iteration | Close (0.85-1.13x) | M6 to close vec gap |
| Indexed get iteration | Done (1.72x) | M5 |
| Insert/remove churn | Close (0.91-1.15x) | M6 to close vec gap |
| Heap scaling | Done (1.0-1.64x) | M5 |
| Entity creation | Structural limit (0.6x) | M7 to reach ~0.7x |
| Tail latency | Done for slab; vec needs work | M8 |

### Direction B: Fast columnar processing

| Category | Status | Milestone |
|---|---|---|
| Column iteration slab | Done (2.77x) | M4 |
| Column iteration vec | Done (2.42x) | M4 |
| Column + lazy iter chains | Not started | M6 |
| Column + string fields | Not started | M9 |

Direction B is already proven and low risk. The primary work remaining is shipping iter chains (M6) and string support (M9) to make column processing ergonomic for more use cases.

---

## Priority Order

1. **Milestone 6** -- Highest impact. Closes remaining closeable gaps, ships bump + iter (Phase 1 complete).
2. **Milestone 7** -- Medium impact. Improves creation story, adds GC pressure benchmarks that tell the full story.
3. **Milestone 8** -- Medium impact. Fixes vec memory issues for production readiness.
4. **Milestone 9** -- Feature expansion. Enables new use cases (string data).
5. **Milestone 10** -- Ship it.
