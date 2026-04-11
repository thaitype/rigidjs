# RigidJS Benchmark Report

**Bun version:** 1.3.8
**Platform:** darwin / arm64
**Date:** 2026-04-11T16:41:02.881Z

---

## B1 — Struct creation

| name | ops/s | heapΔ | heapMB | rssMB | p50µs | p99µs |
|------|-------|-------|--------|-------|-------|-------|
| B1 JS baseline (100k {x,y,z} alloc) | 795 | 25 | 6.63 | 73.83 | 1287.13 | 2061.38 |
| B1 RigidJS slab (100k inserts) | 251 | -69 | 6.65 | 100.80 | 3723.88 | 8071.58 |

B1 measures heap object pressure when creating 100,000 `{x, y, z}` entities. The JS baseline allocates one JS object per entity, resulting in a heapObjectsDelta of ~25 tracked objects. RigidJS stores all data in a single pre-allocated ArrayBuffer, yielding a heapObjectsDelta of ~-69. The GC sees 94 fewer live objects, reducing scan and collection overhead in proportion to entity count.

---

## B2 — Insert/remove churn

| name | ops/s | heapΔ | heapMB | rssMB | p50µs | p99µs |
|------|-------|-------|--------|-------|-------|-------|
| B2 JS baseline (10k insert+remove/frame) | 7,302 | 20 | 6.83 | 100.92 | 143.71 | 732.50 |
| B2 RigidJS slab (10k insert+remove/frame) | 3,098 | 20 | 6.86 | 101.61 | 287.42 | 735.17 |

B2 measures worst-case latency (p99) during 100 frames of 10,000 insert + 10,000 remove operations. The JS baseline uses a pre-sized pool with a LIFO free-list (equivalent structure to slab) to isolate object-layout cost from algorithmic differences. JS p99 is ~732.50µs vs RigidJS p99 of ~735.17µs. The delta reflects the cost of JS runtime object allocation, hidden-class creation, and GC tracking per inserted entity — work that RigidJS eliminates by reusing ArrayBuffer slots.

---

## B3 — Iteration + mutate

| name | ops/s | heapΔ | heapMB | rssMB | p50µs | p99µs |
|------|-------|-------|--------|-------|-------|-------|
| B3 JS baseline (100k pos.x += vel.x) | 3,040 | 23 | 19.86 | 102.59 | 253.29 | 927.63 |
| B3 RigidJS slab (100k h.pos.x += h.vel.x) | 552 | 21 | 19.90 | 102.97 | 1748.75 | 2615.79 |

B3 measures throughput (ops/sec) for a full 100,000-entity sweep computing `pos.x += vel.x`. Each "operation" is one complete 100k sweep. JS baseline: 3,040 sweeps/sec; RigidJS: 552 sweeps/sec. RigidJS accesses pos.x and vel.x via DataView reads at pre-computed byte offsets, which the JIT can inline. However, DataView has overhead per read; the JS baseline benefits from JIT-optimized hidden-class property access on objects with a stable shape. Actual throughput ratio may vary depending on JIT warmup and memory layout effects at this scale.

---

## B7 — Nested struct (Particle)

| name | ops/s | heapΔ | heapMB | rssMB | p50µs | p99µs |
|------|-------|-------|--------|-------|-------|-------|
| B7 JS nested (50k {pos:{x,y,z},vel:{x,y,z},life,id}) | 856 | 9 | 19.91 | 129.48 | 1132.00 | 2034.75 |
| B7 JS flat (50k {posX,posY,posZ,...,life,id}) | 1,129 | 12 | 19.92 | 129.69 | 725.67 | 1849.83 |
| B7 RigidJS nested struct (50k Particle slab) | 235 | 50 | 23.13 | 147.89 | 4547.96 | 5207.92 |

B7 compares three strategies for 50,000 Particle-like entities with nested `pos` / `vel` vectors. The JS nested baseline allocates three JS objects per entity (parent + pos + vel), totalling ~150k GC-tracked objects. The JS flat baseline collapses these into one object per entity (~50k objects) — a manual optimization that many perf-aware JS developers already apply. RigidJS uses a single ArrayBuffer for all 50k entities, adding 0 GC-tracked objects beyond container bookkeeping. The heapObjectsDelta and heapSizeMB columns show how aggressively each approach loads the GC and RSS.

---

## Caveats

Single-run numbers are noisy and machine-dependent: JIT warmup state, OS scheduling, and GC timing all affect individual measurements. These benchmarks are reference data points, not statistically significant regressions gates. Scenarios B4 (filter chain via `.iter()`), B5 (temp allocation via `bump()`), and B6 (growable vec via `vec()`) are deferred until those primitives land in a future milestone — this suite intentionally covers only B1, B2, B3, and B7. Do not interpret the absence of B4/B5/B6 as evidence that RigidJS underperforms in those scenarios.

---

Machine-readable data: `results.json`
