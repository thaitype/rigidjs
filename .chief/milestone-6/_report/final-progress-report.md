# RigidJS Progress Report: Performance vs JavaScript

**Date:** 2026-04-15
**Milestone:** 6 (complete)
**Benchmark environment:** Bun 1.3.8, darwin arm64 (Apple Silicon), per-process isolation
**Previous report:** `.chief/milestone-5/_report/final-progress-report.md`

---

## What is RigidJS?

RigidJS gives you Rust-inspired memory containers (slab, vec) that store data in contiguous `ArrayBuffer` memory instead of JS objects. The engineering goal is to replace JS objects entirely across all workloads -- every operation at >=1x JS-native throughput with strictly better GC characteristics. Today, RigidJS already dominates iteration and sustained workloads. Where gaps remain (creation, iterator protocol), these are active R&D challenges with specific approaches planned, not accepted limitations.

> **End-user communication note:** README and docs messaging should remain practical and honest about current status ("best tool for large, long-lived collections today"). The engineering goal of full JS object replacement is an internal north star that drives milestone planning and R&D priorities.

---

## Section 1: Best Tool for Each Workload

For each workload type, we pick the **best RigidJS container + access mode** and compare it to the equivalent JS pattern. This is what matters to end users — not "can every container beat JS at everything," but "which tool should I reach for?"

### Iterate large collections (the hot loop)

| Access Mode | Best Container | vs JS | When to Use |
|---|---|---|---|
| `slab.column('x')` | **slab** | **4.73x faster** | Bulk numeric processing — sum, transform, physics. Raw `Float64Array` access. |
| `vec.column('x')` | **vec** | **1.67x faster** | Same, but with ordered insertion semantics. |
| `for` + `vec.get(i)` | **vec** | **2.55x faster** | Per-entity field access with object-like ergonomics. Best of both worlds. |
| `vec.forEach(cb)` | **vec** | **1.15x faster** | Callback iteration with handle. Now confirmed above JS baseline. |
| `slab.forEach(cb)` | **slab** | **0.98x** | Iterate with handle, skip holes automatically. Near parity. |
| `slab.forEach(cb)` (handle) | **slab** | **0.77x** | Nested struct handle iteration. Callback overhead architectural. |
| `for..of` | -- | **0.48x** | JS iterator protocol overhead. Use `get(i)` or `forEach` in hot paths. |

**Recommendation:** Use `column()` for maximum speed (1.67-4.73x). Use `get(i)` loop for ergonomic per-entity access (2.55x). `forEach` is above JS baseline (1.15x) — use it when you need automatic iteration without index management. Avoid `for..of` in hot paths.

### Sustained workload (game loop, server tick)

| Workload | Best Container | vs JS | Detail |
|---|---|---|---|
| 100k entities, 1k churn/tick, 10 seconds | **slab** | **2.30x more ticks** | p99: 0.28ms vs JS 0.53ms |
| Same workload | **vec** | **6.15x more ticks** | p99: 0.07ms vs JS 0.37ms — major M6 win |

**Recommendation:** Both slab and vec exceed JS significantly in sustained workloads. Vec now leads dramatically thanks to the swapRemove codegen optimization (M6 Task 3). For sustained insert/remove with stable IDs, slab still offers cleaner p99 semantics; for pure throughput and ordered collections, vec is the winner.

### Small collections (N=10 to 1,000)

Large-scale benchmarks tell one story. But many workloads — config objects, UI component state, small lookup tables — involve 10-1,000 entities. Here is how RigidJS scales across the full range:

**Creation scaling curve:**

| N | Slab vs JS | Vec vs JS | Trend |
|---|---|---|---|
| 10 | 0.11x | 0.03x | Constructor overhead dominates |
| 100 | 0.52x | 0.07x | Per-element cost still minor vs fixed cost |
| 1,000 | 0.74x | 0.14x | Slab approaching parity; vec still far behind due to growth overhead |

At N=10, slab is 9x slower than JS — the `ArrayBuffer` allocation and `new Function()` codegen cost is paid once but spread across only 10 inserts. Vec is even slower due to repeated buffer growth. The ratio improves steadily as N grows and amortizes the fixed cost.

Note: Vec creation numbers are dominated by buffer growth reallocations. Using `reserve()` before push() eliminates this — but B1-vec does not use `reserve()`, reflecting typical "use without pre-sizing" behavior.

**Iteration scaling curve (vec):**

| N | Indexed get(i) vs JS | Column vs JS | Trend |
|---|---|---|---|
| 10 | 1.35x | 2.72x | Both above 1x at very small N |
| 100 | 0.11x | 1.32x | Column stays above 1x; indexed collapses (assertLive overhead) |
| 1,000 | 0.08x | 1.45x | Column dominates; indexed still collapsed |
| 100,000 | 2.55x | 1.67x | Both above 1x at scale |

Column access beats JS at every tested N. The indexed `get(i)` collapse at N=100-1,000 is a known and root-caused issue (Task 1): `get()` performs `assertLive()` + bounds check per call, which at small N (~100 elements) costs more than JS's monomorphic inline cache. At N=100k the overhead amortizes and get(i) leads at 2.55x.

**Churn scaling curve (M6 update):**

| N | Slab vs JS | Vec vs JS | Trend |
|---|---|---|---|
| 10 | 0.25x | 0.72x | Vec churn competitive even at small N |
| 100 | 0.34x | 0.79x | Vec near parity |
| 1,000 | 0.16x | 0.67x | Slab falls behind at small N; vec stays reasonable |
| 10,000 | **1.10x** | **2.83x** | Slab above 1x; vec dramatically above 1x (M6 win) |

Vec churn at large N improved from 0.91x (M5) to 2.83x (M6) due to swapRemove codegen unrolling. At small N, vec churn is now 0.67-0.79x — improved vs M5 (was 0.51-0.67x).

**Recommendation for small collections:** Use `column()` access (beats JS at all tested N). For creation-heavy small workloads, plain JS objects remain faster. The hybrid container (M7) specifically targets this gap.

### Heap scaling (how does perf change as entity count grows?)

**Slab:**

| Entity Count | Throughput vs JS | p99 vs JS |
|---|---|---|
| 10k | 1.07x | 1.70x better p99 |
| 100k | 1.02x | 2.14x better p99 |
| 1M | 1.14x | 1.62x better p99 |

**Vec (new in M6 — buffer fix enabled this measurement):**

| Entity Count | Throughput vs JS | p99 vs JS |
|---|---|---|
| 10k | **2.03x** | 1.36x better p99 |
| 100k | **2.41x** | 2.12x better p99 |
| 1M | **3.55x** | **5.63x better p99** |

This is the core Direction A proof: as entity count grows, RigidJS gets relatively faster while JS gets relatively slower. At 1M entities, vec delivers 3.55x more throughput with 5.63x lower p99 latency. JS's GC cost scales with object count; RigidJS's does not.

### Insert/remove churn (pool management)

| Workload | Best Container | vs JS |
|---|---|---|
| 10k insert + remove per frame | **slab** | **1.10x faster** |
| 10k push + swapRemove per frame | **vec** | **2.83x faster** (was 0.91x in M5) |

**Recommendation:** Both slab and vec now beat JS for churn workloads at 10k. Vec's improvement is the major M6 win — swapRemove codegen unrolling transformed vec churn from near-parity to a significant advantage.

### Entity creation (initial setup)

| Workload | Best Container | vs JS |
|---|---|---|
| 100k flat structs (3 fields) | slab | **0.52x** |
| 100k flat structs with `push()` | vec | **0.08x** (use `reserve()` to avoid growth) |
| 50k nested structs (8 fields) | slab | **0.45x** |

**JS is currently faster here.** JS engines have spent 15+ years optimizing `{x: 1, y: 2, z: 3}` — it compiles to a single JIT opcode. RigidJS pays upfront for ArrayBuffer allocation and per-field writes. This is an active R&D challenge, not an accepted limitation. Specific approaches are planned: hybrid containers that use JS objects internally for small/short-lived allocations and graduate to ArrayBuffer at scale (M7), batch insert APIs that amortize per-element overhead (M7).

**Why it often doesn't matter today:** If you create 100k entities once and iterate them 1,000 times per second, the 0.52x creation cost is amortized away in <1 second. After that, you're running at 1.67-4.73x on every iteration.

### GC pressure (the invisible win)

| Metric | RigidJS | JS | Ratio |
|---|---|---|---|
| Heap objects for 100k entities | ~40 | ~100,040 | **2,500x fewer** |
| RSS at 1M entities (slab) | 99 MB | 479 MB | **4.8x less memory** |
| RSS at 1M entities (vec) | 54 MB | 421 MB | **7.8x less memory** |
| p99 at 1M sustained (slab) | 2.58ms | 4.18ms | **1.62x lower** |
| p99 at 1M sustained (vec) | 2.51ms | 14.10ms | **5.63x lower** |
| Max spike at 1M sustained (vec) | 12.75ms | 99.41ms | **7.8x lower** |

This doesn't show up in throughput benchmarks, but it matters in production: fewer GC objects means shorter GC pauses, which means your UI doesn't jank and your server doesn't spike p99.

---

## Section 2: Summary — Pick Your Tool

| Your Workload | Use This | Expected vs JS |
|---|---|---|
| Bulk numeric processing (physics, particles, transforms) | `slab` + `column()` | **4.73x faster** |
| Game loop / ECS tick with per-entity logic | `vec` + `get(i)` loop | **2.55x faster** |
| Callback-based iteration | `vec` + `forEach` | **1.15x faster** |
| Long-lived entity pool with insert/remove | `slab` + `forEach` | **1.1x faster, 2.3x sustained** |
| High-throughput sustained churn workload | `vec` | **2.83x churn, 6.15x sustained throughput** |
| Large dataset (100k-1M) with low-latency requirement | `vec` (any access mode) | **2.4-3.6x throughput, 2-6x better p99** |
| Short-lived objects, request/response | **Plain JS objects** (until hybrid container ships in M7) | JS is 1.5-2.5x faster for creation today |
| Small collections (<1k entities), creation-heavy | **Plain JS objects** (until hybrid container ships in M7) | JS is 7-33x faster for vec creation at N=10-100. But `column()` access beats JS at all N. If you create once and iterate many times, RigidJS wins via column access. |

---

## Section 3: Required R&D Roadmap to Close Remaining Gaps

The following are not speculative ideas — they are the planned R&D techniques RigidJS will pursue to achieve >=1x JS throughput across all operations. Each approach targets a specific gap identified in the benchmark data.

### R&D 1: Hybrid Container — "fast-vec" (M7) — CRITICAL PRIORITY

**Idea:** A vec variant that uses raw JS hidden-class objects internally for insert/creation, but stores references in a TypedArray-backed index for iteration. On iteration, it reads from the JS objects but follows a contiguous index — giving cache-friendly traversal order.

**What it solves:** Creation speed (uses JS engine's optimized object allocation) while maintaining structured iteration order.

**What it trades away:** GC pressure win (objects are still GC-tracked). Memory density (JS objects are ~500 bytes vs 56 bytes per entity).

**Why small-scale data makes this critical:** The small-scale benchmarks reveal that creation is 0.03x at N=10 (vec) and 0.11x at N=10 (slab) — far worse than at N=100k. The fixed constructor overhead (ArrayBuffer allocation, `new Function()` codegen) is catastrophic for small collections. A hybrid container that defers ArrayBuffer allocation until N exceeds a threshold (e.g., 64 or 256) would eliminate this penalty entirely.

**Expected outcome:** ~1x creation AND ~1x iteration at all collection sizes, trading GC and memory advantages at small N.

### R&D 2: Batch Insert API — "insertBatch" (M7)

**Idea:** `slab.insertBatch(data, count)` or `vec.pushBatch(data, count)` that accepts a pre-packed `Float64Array` and copies it into the container's buffer with a single `TypedArray.set()` call per column, instead of per-entity handle rebase + per-field writes.

**What it solves:** Creation gap. Instead of 100k individual inserts (each with rebase + field writes), one bulk copy. Target: bring B1-slab from 0.52x to ~0.80-0.90x.

**What it trades away:** Ergonomics — user must pre-pack data into a typed array. Good for loading from files, network, or generating procedurally.

**Expected outcome:** High impact, medium effort. Natural fit for data loading pipelines. Scheduled for M7.

### R&D 3: Unchecked Access API (M7)

**Idea:** `vec.getUnchecked(i)` that skips `assertLive()` + bounds check per call. This would eliminate the per-call overhead that causes the small-N get(i) collapse (root-caused in M6 Task 1).

**What it solves:** The small-N `get(i)` collapse. At N=100, `getUnchecked()` would behave like `forEach` cost-wise (~1.2-2.2 ns/elem vs current ~3-8 ns/elem).

**What it trades away:** Safety (no bounds check, no drop check per call). The user takes responsibility for valid indices and container lifetime.

**Expected outcome:** Brings `get(i)` performance at small N to near-forEach levels. Users who know their indices are valid can opt into the faster path.

### R&D 4: JS-Object-Backed Container — "gc-vec" (M8)

**Idea:** A container that wraps a normal JS array internally but adds RigidJS's structured API (typed fields, column access, `drop()`). It tracks GC pressure by counting allocations. Zero perf penalty on creation/mutation (it IS JS objects underneath), but provides the column access API for fast bulk reads by lazily materializing TypedArray views.

**What it solves:** Creation parity (1x) + gives users a migration path. Start with gc-vec, profile, upgrade to vec when GC becomes the bottleneck.

**What it trades away:** GC pressure (same as JS). Column access requires materialization step (not free).

**Expected outcome:** The "level 0" container. Users start here, then graduate to vec/slab when they need the GC-free guarantees. Scheduled for M8.

---

## Section 4: Roadmap — What's Coming

| Milestone | Focus | Key Deliverable | Impact |
|---|---|---|---|
| **M6** | Close closeable gaps | swapRemove codegen (DONE: 0.91x→2.83x), forEach confirmed >=1x, get(i) root-caused | Churn gap closed; forEach confirmed |
| **M7** | Creation mitigation | Batch insert API, hybrid container exploration, unchecked access API | Creation 0.52x → 0.80x+; small-N improvement |
| **M8** | Vec memory + production readiness | Shrink-to-fit, growth tuning, memory accounting, gc-vec exploration | Vec p99 further reduced; clean RSS |
| **M9** | String support | Fixed-length and variable-length string fields | New use cases |
| **M10** | Ship it | Docs, examples, npm 0.1.0 | Public release |

### End Goal Status

**Direction A — All ops >=1x with GC-free:**
- **M6 update:** 10+ operations now above 1x at large N (100k)
- vec forEach confirmed above 1x (1.15x) — previously measured as 0.85x under JIT disruption
- vec churn improved from 0.91x to 2.83x — now a clear win
- 4 operations remain below 1x at large N: creation (slab 0.52x, vec 0.08x), slab forEach handle (0.77x), for..of (0.48x) — each has a planned R&D approach
- Small-scale gaps remain significant for creation (0.03-0.11x at N=10) — hybrid container (M7) is the primary mitigation
- Column access beats JS at every tested N — the SoA layout strategy is validated across all collection sizes

**Direction B — Fast columnar processing:**
- Proven at 1.67-4.73x. No regression risk.
- B9-vec scaling now shows 2.03-3.55x across 10k-1M entities.

### Current Status and Path Forward

RigidJS dominates iteration, churn, and sustained workloads: **2-4.7x faster bulk processing, 2.3-6.2x faster sustained workloads, 2-6x better tail latency at scale, 4-8x less memory, near-zero GC pressure.**

Where JS is currently faster (entity creation at 0.52x for slab, 0.08x for vec; iterator protocol at 0.48x), these are classified as R&D challenges with specific approaches planned and scheduled across M7-M8.

The user's decision framework today:
- **"I create once, iterate many times"** → RigidJS wins at every N via column access
- **"I need high-throughput churn (push+remove)"** → RigidJS vec wins at 2.83x (major M6 improvement)
- **"I create and destroy constantly"** → JS is faster today; batch insert (M7) and hybrid container (M7) target this gap
- **"I need predictable latency at scale"** → RigidJS wins decisively — vec at 1M entities: 5.63x lower p99
- **"I have small collections (N<100)"** → JS is faster for creation (7-33x for vec); use column access if iteration-heavy, otherwise plain JS until hybrid container (M7)
