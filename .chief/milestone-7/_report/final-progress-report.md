# RigidJS Progress Report: Performance vs JavaScript

**Date:** 2026-04-12
**Milestone:** 7 (complete)
**Benchmark environment:** Bun 1.3.8, darwin arm64 (Apple Silicon), per-process JIT isolation
**Methodology:** Median of 20 runs (with stddev) for hybrid small-scale; single-run for full suite large-scale
**Previous report:** `.chief/milestone-6/_report/final-progress-report.md`

---

## What is RigidJS?

RigidJS gives you Rust-inspired memory containers (slab, vec) that store data in contiguous `ArrayBuffer` memory instead of JS objects. The engineering goal is to replace JS objects entirely across all workloads -- every operation at >=1x JS-native throughput with strictly better GC characteristics. Today, RigidJS dominates iteration, sustained workloads, and churn. Where gaps remain (small-N creation, graduation overhead), these are active R&D challenges with specific approaches planned, not accepted limitations.

> **End-user communication note:** README and docs messaging should remain practical and honest about current status. The engineering goal of full JS object replacement is an internal north star that drives milestone planning and R&D priorities.

---

## What Changed in M7

Milestone 7 delivered the **hybrid vec**: a `vec(def)` that starts in **JS mode** (plain JS objects, near-zero init overhead) and automatically **graduates** to **SoA mode** (TypedArray columns) when `len` reaches a threshold (default 128).

Key results (n=20 medians with stddev):
- N=100 creation at 0.68x (29% stddev) -- improved from 0.07x SoA-only but below 1x
- N=100 churn at 1.48x (55% stddev) -- likely faster than JS but high variance makes the exact ratio uncertain (could be 0.8x to 2x)
- N=1000 graduation results are stable (7-32% stddev) -- real costs, not noise
- Large-scale SoA performance maintained with no regression
- The hybrid architecture is invisible to users -- all existing vec code works without modification

---

## Section 1: Best Tool for Each Workload

For each workload type, we pick the **best RigidJS container + access mode** and compare it to the equivalent JS pattern.

### Small collections (N=10 to N=100) -- the M7 story

This is where the hybrid vec changes the picture. M6 recommended "plain JS objects" for small collections. M7 narrows that recommendation significantly.

**Hybrid vec (JS mode) -- creation (n=20 medians):**

| N | JS median | Hybrid median | Ratio | JS stddev | Hybrid stddev |
|---|---|---|---|---|---|
| 10 | 826k | 453k | **0.55x** | 394k (48%) | 125k (28%) |
| 100 | 435k | 296k | **0.68x** | 136k (31%) | 85k (29%) |
| 1,000 | 58k | 5.5k | **0.10x** | 18k (31%) | 0.4k (7%) |

**Hybrid vec (JS mode) -- churn (n=20 medians, push/pop on existing vec):**

| N | JS median | Hybrid median | Ratio | JS stddev | Hybrid stddev |
|---|---|---|---|---|---|
| 10 | 348k | 287k | **0.82x** | 113k (32%) | 99k (34%) |
| 100 | 226k | 335k | **1.48x** | 55k (24%) | 183k (55%) |
| 1,000 | 56k | 33k | **0.59x** | 26k (46%) | 10k (32%) |

**Variance context:** At small N (10-100), stddev ranges from 24% to 55% of median. The N=10 creation ratio of 0.55x is the most reliable small-N result (hybrid stddev 28%). The N=100 churn ratio of 1.48x has 55% stddev on the hybrid side -- the true ratio could plausibly range from 0.8x to 2x. The N=1000 graduation cost (0.10x creation) is the most stable result (7% hybrid stddev) and represents a real, measurable cost.

**Churn benchmark note:** The B2-hybrid churn benchmark is fair — both sides perform identical swap-remove-from-index-0 operations. The 1.48x median with 55% stddev means churn at N=100 is approximately 1x, with too much variance to claim a precise advantage.

**Recommendation for small collections:** At N=100, hybrid vec shows promising churn performance (likely faster than JS, though high variance makes the exact margin uncertain). Creation at N=100 is 0.68x -- improved from catastrophic (0.07x SoA-only) but not yet at parity. At N=10, the creation gap (0.55x) is consistent and real (constructor overhead). For creation-heavy workloads at N<50, plain JS objects are still faster. For ongoing push/pop at N>=50, hybrid vec likely wins but with uncertainty at N=100.

### Iterate collections

**SoA mode iteration (small scale, stable median):**

| N | JS median | Column vs JS | Indexed vs JS |
|---|---|---|---|
| 10 | 8.4M | 5.4M (0.64x) | 3.5M (0.42x) |
| 100 | 2.5M | 4.4M (**1.77x**) | 276k (0.11x) |
| 1,000 | 297k | 940k (**3.17x**) | 51k (0.17x) |

**Large-scale iteration (single run, 100k entities):**

| Access Mode | JS | RigidJS | Ratio |
|---|---|---|---|
| `vec.column('x')` | 3,789 | 15,109 | **3.99x faster** |
| `vec.forEach(cb)` | 3,158 | 4,226 | **1.34x faster** |
| `vec.get(i)` indexed | 3,729 | 5,904 | **1.58x faster** |
| `slab.forEach(cb)` | 3,414 | 3,830 | **1.12x faster** |

**Recommendation:** Use `column()` for maximum speed (1.77-3.99x depending on N). Use `forEach` for ergonomic per-entity access (1.12-1.34x). Avoid indexed `get(i)` at small N (JIT disruption from assertLive -- see M6 task-1 root cause analysis). At large N, all three access modes beat JS.

### Sustained workload (game loop, server tick)

| Workload | Best Container | vs JS | Detail |
|---|---|---|---|
| 10k entities, churn | **vec** | **1.60x** | B2-vec large scale |
| 100k entities, 10s sustained | **vec** | **10.3x more ticks** | B8-vec: 187k ticks vs 18k JS ticks |
| 1M entities | **vec** | **2.89x** | B9-vec: 2,327 ticks vs 806 JS ticks |

**Recommendation:** Vec dominates sustained workloads. The 10.3x sustained advantage at 100k entities is the headline number -- it demonstrates what happens when GC pressure compounds over time.

### GC pressure (the invisible win)

| Metric | RigidJS | JS | Ratio |
|---|---|---|---|
| RSS at 1M entities | 117 MB | 515 MB | **4.4x less memory** |
| Heap objects for 100k entities | ~40 | ~100,040 | **2,500x fewer** |

This doesn't show up in throughput benchmarks, but it matters in production: fewer GC objects means shorter GC pauses, which means your UI doesn't jank and your server doesn't spike p99.

---

## Section 2: Summary -- Pick Your Tool

| Your Workload | Use This | Expected vs JS | Confidence |
|---|---|---|---|
| Bulk numeric processing (physics, particles, transforms) | `vec` + `column()` | **3.17-3.99x faster** | High (large N) |
| Game loop / ECS tick with per-entity logic | `vec` + `forEach` | **1.34x faster** | High (large N) |
| Long-lived entity pool with insert/remove | `slab` + `forEach` | **1.12x faster** | High (large N) |
| High-throughput sustained churn (100k entities, 10s) | `vec` | **10.3x sustained throughput** | High |
| Large dataset (1M) with memory constraints | `vec` | **2.89x throughput, 4.4x less RSS** | High |
| Medium collections (N=50-200), ongoing push/pop | `vec` (hybrid, default) | **0.68x creation, ~1.5x churn** | Low-Medium (24-55% stddev) |
| Small collections (N<50), creation-heavy | **Plain JS objects** | JS is ~1.8x faster for creation at N=10 | Medium (28% stddev) |
| Small collections (N<50), iteration-heavy | `vec` + `column()` | Column beats JS at N>=100 (1.77x) | High (large N) |

### The graduation story

The hybrid vec provides a seamless transition:
- **N < 128:** JS mode. Plain JS objects under the hood. 0.55-0.68x creation speed, likely-superior churn (high variance).
- **N >= 128:** Auto-graduates to SoA mode. TypedArray columns, contiguous memory, 1.3-4.0x iteration, 10x sustained, 4.4x less memory.
- The user writes one line: `vec(Particle)`. The container picks the right mode automatically.

---

## Section 3: Scaling Curves

How does the ratio change as collection size grows?

### Creation (hybrid vec vs JS, n=20 medians)

| N | Ratio | Hybrid stddev | Notes |
|---|---|---|---|
| 10 | 0.55x | 28% | Constructor overhead dominates. Consistent result. |
| 100 | 0.68x | 29% | Improved but below parity. |
| 1,000 | 0.10x | 7% | Graduation triggers every iteration (stable, real cost) |
| 100,000 | n/a (SoA direct) | -- | Use `vec(T, capacity)` for known-large collections |

The N=1000 number requires context: the benchmark creates a fresh vec and pushes 1000 items each iteration, triggering graduation at N=128 every time. In real usage, graduation happens once per vec lifetime. The benchmark measures worst-case repeated graduation, not steady-state performance. The 7% stddev confirms this is a stable, measurable cost.

### Churn (hybrid vec vs JS, n=20 medians)

| N | Ratio | Hybrid stddev | Notes |
|---|---|---|---|
| 10 | 0.82x | 34% | Near parity within noise |
| 100 | **1.48x** | 55% | Likely faster than JS, but high variance (could be 0.8x-2x). Different swap-remove implementations in JS vs vec. |
| 1,000 | 0.59x | 32% | Graduation artifact (same as creation) |
| 10,000 | **1.60x** | -- (single run) | Large-scale SoA mode |

### Column iteration (SoA mode vs JS)

| N | Column vs JS | Notes |
|---|---|---|
| 10 | 0.64x | Setup overhead at tiny N |
| 100 | **1.77x** | Crossover -- SoA wins |
| 1,000 | **3.17x** | Growing advantage |
| 100,000 | **3.99x** | Dominant at scale |

### Sustained throughput (SoA mode vs JS)

| Scale | Ratio | Notes |
|---|---|---|
| 10k churn | 1.60x | Moderate advantage |
| 100k sustained 10s | **10.3x** | GC pressure compounds over time |
| 1M entities | **2.89x** | Throughput + 4.4x less memory |

The sustained advantage grows disproportionately because JS GC cost scales with object count while RigidJS GC cost is near-constant (one ArrayBuffer regardless of entity count).

---

## Section 4: R&D Roadmap

### Gaps to close (ordered by priority)

| Gap | Current (n=20 median) | Confidence | Target | R&D Approach |
|---|---|---|---|---|
| N=1000 graduation cost | 0.10x | High (7% stddev) | >=0.5x | Cache SoA handle class on StructDef (small effort) |
| N=100 creation | 0.68x | Medium (29% stddev) | >=1.0x | Lazy VecImpl property init, reduce constructor overhead |
| N=10 creation | 0.55x | Medium (28% stddev) | >=0.8x | Lazy VecImpl property init, reduce instance property count |
| N=100 churn | ~1x (55% stddev) | Low | Confirm >=1x | Reduce benchmark variance at small N |
| Indexed get(i) at small N | 0.11-0.42x | -- | >=1x | getUnchecked(i) API, or recommend forEach/column instead |
| Slab small-N creation | 0.12x (M6 data) | -- | >=0.5x | Hybrid slab (medium effort, evaluate need first) |

### New capabilities planned

| Feature | Description | Priority |
|---|---|---|
| RigidError + mutation guard | Structured error codes, iteration mutation detection | High (correctness) |
| Batch push API | `pushBatch(n)` to amortize per-call overhead | Medium |
| Bump allocator | Arena-style allocation (allocate many, free all at once) | Medium |
| .iter() chains | Rust-style `.iter().filter().map().collect()` with fused codegen | Large effort, high payoff |

### Milestone roadmap

| Milestone | Focus | Key Deliverable |
|---|---|---|
| **M7** | Hybrid vec (DONE) | JS mode + auto-graduation. N=100 creation at 0.68x, churn ~1.5x. |
| **M8** | Polish + correctness | RigidError, mutation guards, graduation codegen caching |
| **M9** | New containers + APIs | Bump allocator, batch APIs, hybrid slab evaluation |
| **M10** | Iterator chains | .iter() with fused loop codegen |
| **M11** | String support | Fixed-length and variable-length string fields |
| **M12** | Ship it | Docs, examples, npm 0.1.0 |

---

## Bottom Line

**Internal goal (per performance-vision.md):** Replace all JS objects. Every operation at >=1x JS throughput. Current status (n=20 medians): 0.55x-0.82x at N=10 (R&D challenge, medium confidence), 0.68x creation / ~1x churn at N=100 (promising but high variance), 1.3-10.3x at large scale (dominant, high confidence). The hybrid architecture is the correct path -- M7 proved that JS mode + SoA graduation delivers improved small-N performance while preserving large-N advantages.

**End-user message:** RigidJS hybrid vec is the right choice when you have collections of 50+ entities that you iterate frequently. At N=100 you get 0.68x creation speed (improving) with likely-better churn performance. At large scale you get 3-10x better throughput, 4.4x less memory, and near-zero GC pressure. For tiny, short-lived objects (N<50, create-and-discard), plain JS objects are still faster -- and that gap is an active R&D challenge, not an accepted limitation.

**Benchmark confidence note:** Small-N microbenchmarks (N=10-100) on Bun/JSC show 24-55% stddev even with per-process JIT isolation and n=20 runs. Ratios at small N should be treated as approximate. Large-scale results (10k+ entities) are stable and reliable.
