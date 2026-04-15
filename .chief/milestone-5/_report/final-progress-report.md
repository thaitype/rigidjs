# RigidJS Progress Report: Performance vs JavaScript

**Date:** 2026-04-15
**Milestone:** 5 (complete)
**Benchmark environment:** Bun 1.3.8, darwin arm64 (Apple Silicon), per-process isolation

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
| `vec.column('x')` | **vec** | **2.42x faster** | Bulk numeric processing — sum, transform, physics. You work with raw `Float64Array`. |
| `slab.column('x')` | **slab** | **2.77x faster** | Same, but need stable slot IDs with insert/remove. |
| `for` + `vec.get(i)` | **vec** | **1.72x faster** | Need per-entity field access with object-like ergonomics. |
| `slab.forEach(cb)` | **slab** | **1.13x faster** | Iterate with handle, skip holes automatically. |
| `vec.forEach(cb)` | **vec** | **0.85x** | Callback overhead keeps it slightly below JS. R&D target: handle rebase optimization (M6) to reach >=1x. |
| `for..of` | -- | **0.37-0.83x** | JS iterator protocol overhead. R&D target: JIT-friendly iterator (M6). Use `get(i)` or `column()` in hot paths today. |

**Recommendation:** Use `column()` for maximum speed (2.4-2.8x). Use `get(i)` loop for ergonomic per-entity access (1.7x). Use `forEach` when you need slab's hole-skipping. Avoid `for..of` in hot paths.

### Sustained workload (game loop, server tick)

| Workload | Best Container | vs JS | Detail |
|---|---|---|---|
| 100k entities, 1k churn/tick, 10 seconds | **slab** | **2.18x more ticks** | p99: 0.20ms vs JS 0.29ms |
| Same workload | **vec** | **1.49x more ticks** | Higher throughput but p99 needs work (0.75ms) |

**Recommendation:** For sustained workloads, **slab** is the proven winner today. Vec has higher throughput but needs memory management improvements for clean tail latency.

### Small collections (N=10 to 1,000)

Large-scale benchmarks tell one story. But many workloads -- config objects, UI component state, small lookup tables -- involve 10-1,000 entities. Here is how RigidJS scales across the full range:

**Creation scaling curve:**

| N | Slab vs JS | Vec vs JS | Trend |
|---|---|---|---|
| 10 | 0.12x | 0.37x | Constructor overhead dominates |
| 100 | 0.21x | 0.27x | Per-element cost still minor vs fixed cost |
| 1,000 | 0.37x | 0.44x | Per-element cost starting to dominate |
| 100,000 | 0.60x | 0.62x | Per-element cost dominates; ratio stabilizes |

At N=10, slab is 8x slower than JS -- the `ArrayBuffer` allocation and `new Function()` codegen cost is paid once but spread across only 10 inserts. The ratio improves steadily as N grows and amortizes the fixed cost.

**Iteration scaling curve (vec):**

| N | Indexed get(i) vs JS | Column vs JS | Trend |
|---|---|---|---|
| 10 | 0.59x | 0.55x | Both below 1x; loop too small for JIT payoff |
| 100 | 0.20x | **1.10x** | Column crosses 1x; indexed collapses |
| 1,000 | 0.16x | **3.18x** | Column dominates; indexed still collapsed |
| 100,000 | **1.72x** | **2.42x** | Both above 1x at scale |

The standout finding: **column access beats JS even at N=100** (1.10x), making it competitive for surprisingly small collections. This validates the SoA layout strategy across all practical sizes.

The indexed get(i) collapse at N=100-1,000 (0.16-0.20x) is anomalous and under investigation -- likely a JIT warm-up artifact at intermediate loop sizes. At N=100k it recovers to 1.72x.

**Churn scaling curve:**

| N | Slab vs JS | Vec vs JS | Trend |
|---|---|---|---|
| 10 | 0.39x | 0.51x | Fixed overhead dominates |
| 100 | 0.30x | 0.67x | Vec churn competitive earlier than slab |
| 1,000 | 0.63x | 0.55x | Converging toward parity |
| 10,000 | **1.15x** | 0.91x | Slab crosses 1x; vec near parity |

**Recommendation for small collections:** Use `column()` access (competitive at N>=100). For creation-heavy small workloads, plain JS objects remain faster today. The hybrid container (M7) specifically targets this gap by using JS objects internally below a threshold and graduating to ArrayBuffer layout above it.

### Heap scaling (how does perf change as entity count grows?)

| Entity Count | Best Container | Throughput vs JS | p99 Latency vs JS |
|---|---|---|---|
| 10k | vec | 1.23x | 1.3x worse (tiny absolute: 0.045ms) |
| 100k | vec | **1.57x** | **3.3x better** (0.15ms vs 0.50ms) |
| 1M | vec | **1.64x** | **1.6x better** (2.44ms vs 3.89ms) |

**This is the core Direction A proof:** as entity count grows, RigidJS gets relatively faster while JS gets relatively slower. At 1M entities, vec delivers 64% more throughput with 37% lower p99 latency. JS's GC cost scales with object count; RigidJS's does not.

### Insert/remove churn (pool management)

| Workload | Best Container | vs JS |
|---|---|---|
| 10k insert + remove per frame | **slab** | **1.15x faster** |
| 10k push + swapRemove per frame | **vec** | **0.91x** (close to parity) |

**Recommendation:** Slab for pooled entities with stable IDs. Vec is close to parity (0.91x) -- column swap optimization (M6) targets closing this gap to >=1x.

### Entity creation (initial setup)

| Workload | Best Container | vs JS |
|---|---|---|
| 100k flat structs (3 fields) | slab | **0.60x** |
| 100k flat structs with `reserve()` | vec | **~0.70x** |
| 50k nested structs (8 fields) | slab | **0.42x** |

**JS is currently faster here.** JS engines have spent 15+ years optimizing `{x: 1, y: 2, z: 3}` -- it compiles to a single JIT opcode. RigidJS pays upfront for ArrayBuffer allocation and per-field writes. This is an active R&D challenge, not an accepted limitation. Specific approaches are planned: hybrid containers that use JS objects internally for small/short-lived allocations and graduate to ArrayBuffer at scale (M7), batch insert APIs that amortize per-element overhead (M7), and bump allocators for temporary batch allocations (M6).

**Why it often doesn't matter today:** If you create 100k entities once and iterate them 1,000 times per second, the 0.6x creation cost is amortized away in <1 second. After that, you're running at 1.7-2.8x on every iteration.

### GC pressure (the invisible win)

| Metric | RigidJS | JS | Ratio |
|---|---|---|---|
| Heap objects for 100k entities | ~40 | ~100,040 | **2,500x fewer** |
| RSS at 1M entities | 99 MB | 478 MB | **4.8x less memory** |
| p99 at 1M sustained | 2.35ms | 3.11ms | **25% lower** |
| Max spike at 1M sustained | 2.95ms | 9.92ms | **3.4x lower** |

This doesn't show up in throughput benchmarks, but it matters in production: fewer GC objects means shorter GC pauses, which means your UI doesn't jank and your server doesn't spike p99.

---

## Section 2: Summary — Pick Your Tool

| Your Workload | Use This | Expected vs JS |
|---|---|---|
| Bulk numeric processing (physics, particles, transforms) | `vec` + `column()` | **2.4x faster** |
| Game loop / ECS tick with per-entity logic | `vec` + `get(i)` loop | **1.7x faster** |
| Long-lived entity pool with insert/remove | `slab` + `forEach` | **1.1x faster, 2.2x sustained** |
| Large dataset (100k-1M) with low-latency requirement | `vec` (any access mode) | **1.6x throughput, 3x better p99** |
| Short-lived objects, request/response | **Plain JS objects** (until hybrid container ships in M7) | JS is 1.5-2.5x faster for creation today |
| Small collections (<1k entities), creation-heavy | **Plain JS objects** (until hybrid container ships in M7) | JS is 3-8x faster for creation at N=10-100. But `column()` access beats JS even at N=100 (1.10x). If you create once and iterate many times, RigidJS can still win at small N via column access. |

---

## Section 3: Required R&D Roadmap to Close Remaining Gaps

The following are not speculative ideas -- they are the planned R&D techniques RigidJS will pursue to achieve >=1x JS throughput across all operations. Each approach targets a specific gap identified in the benchmark data.

### R&D 1: Hybrid Container -- "fast-vec" (M7) -- CRITICAL PRIORITY

**Idea:** A vec variant that uses raw JS hidden-class objects internally for insert/creation, but stores references in a TypedArray-backed index for iteration. On iteration, it reads from the JS objects but follows a contiguous index -- giving cache-friendly traversal order.

**What it solves:** Creation speed (uses JS engine's optimized object allocation) while maintaining structured iteration order.

**What it trades away:** GC pressure win (objects are still GC-tracked). Memory density (JS objects are ~500 bytes vs 56 bytes per entity).

**Why small-scale data makes this critical:** The small-scale benchmarks reveal that creation is 0.12x at N=10 and 0.21x at N=100 -- far worse than the 0.60x at N=100k. The fixed constructor overhead (ArrayBuffer allocation, `new Function()` codegen) is catastrophic for small collections. A hybrid container that defers ArrayBuffer allocation until N exceeds a threshold (e.g., 64 or 256) would eliminate this penalty entirely. The crossover threshold can be calibrated from the benchmark data: column access already wins at N=100, so graduation from JS-backed to ArrayBuffer-backed could happen as early as N=64.

**Expected outcome:** ~1x creation AND ~1x iteration at all collection sizes, trading GC and memory advantages at small N. Serves as the "level 1" container for users migrating from plain JS objects, and as the default recommendation for small/short-lived collections until further optimizations land.

### R&D 2: Batch Insert API -- "insertBatch" (M7)

**Idea:** `slab.insertBatch(data, count)` or `vec.pushBatch(data, count)` that accepts a pre-packed `Float64Array` and copies it into the container's buffer with a single `TypedArray.set()` call per column, instead of per-entity handle rebase + per-field writes.

**What it solves:** Creation gap. Instead of 100k individual inserts (each with rebase + field writes), one bulk copy. Target: bring B1 from 0.60x to ~0.80-0.90x.

**What it trades away:** Ergonomics -- user must pre-pack data into a typed array. Good for loading from files, network, or generating procedurally.

**Expected outcome:** High impact, medium effort. Natural fit for data loading pipelines. Scheduled for M7.

### R&D 3: Arena-style "bump" Allocator (M6)

**Idea:** A bump allocator (already in the design spec) that allocates by incrementing a pointer. No freelist, no bitmap -- just `offset += sizeof`. Fastest possible allocation. Deallocates all-at-once via `drop()`.

**What it solves:** Creation speed for temporary, batch-allocated data. Target: ~0.80-0.90x for creation by eliminating freelist/bitmap overhead.

**What it trades away:** No individual removal. You create, process, and drop the entire arena. Good for per-frame temporaries, query results, staging buffers.

**Expected outcome:** High impact for its niche. Scheduled for M6.

### R&D 4: JIT-Friendly Handle Rebase (M6)

**Idea:** Instead of setting `this._slot = newIndex` on each rebase (which the JIT sees as a mutable property), pre-compute a byte offset stride and advance by addition: `this._offset += stride`. The generated accessor reads `column[this._offset]` directly.

**What it solves:** The 10ns/element handle rebase cost (vs JS's 2ns property access). Target: bring forEach from 0.85x to ~1.0x.

**What it trades away:** Complexity in codegen. May not work for SoA layout where columns have different element sizes (stride differs per column).

**Expected outcome:** If successful, closes the forEach gap entirely. Scheduled for M6 investigation.

### R&D 5: JS-Object-Backed Container -- "gc-vec" (M8)

**Idea:** A container that wraps a normal JS array internally but adds RigidJS's structured API (typed fields, column access, `drop()`). It tracks GC pressure by counting allocations. Zero perf penalty on creation/mutation (it IS JS objects underneath), but provides the column access API for fast bulk reads by lazily materializing TypedArray views.

**What it solves:** Creation parity (1x) + gives users a migration path. Start with gc-vec, profile, upgrade to vec when GC becomes the bottleneck.

**What it trades away:** GC pressure (same as JS). Column access requires materialization step (not free).

**Expected outcome:** The "level 0" container. Users start here, then graduate to vec/slab when they need the GC-free guarantees. Scheduled for M8.

---

## Section 4: Roadmap — What's Coming

| Milestone | Focus | Key Deliverable | Impact |
|---|---|---|---|
| **M6** | Close closeable gaps | forEach → ≥1x, bump allocator, iter chains | All "close" gaps eliminated |
| **M7** | Creation mitigation | Batch insert, GC pressure benchmarks, hybrid container exploration | Creation 0.60x → 0.80x+ |
| **M8** | Vec memory + production readiness | Shrink-to-fit, growth tuning, memory accounting, gc-vec exploration | Vec p99 < 0.5ms, clean RSS |
| **M9** | String support | Fixed-length and variable-length string fields | New use cases |
| **M10** | Ship it | Docs, examples, npm 0.1.0 | Public release |

### End Goal Status

**Direction A -- All ops >=1x with GC-free:**
- 9 operations already above 1x at large N (100k)
- 3 operations closeable in M6 (0.85-0.91x -> >=1x)
- 6 operations currently below 1x at large N (0.37-0.66x) -- each has a planned R&D approach (see Section 3) with specific milestone targets
- Small-scale gaps are significantly worse (0.12x creation at N=10) -- hybrid container (M7) is the primary mitigation
- Column access is the bright spot: already beats JS at N=100 (1.10x) and dominates at N=1,000 (3.18x)
- Alternative APIs already exist for every slow path (column, get(i), forEach replace for..of)

**Direction B -- Fast columnar processing:**
- Already proven at 2.4-2.8x. No regression risk.
- Iter chains (M6) and string support (M9) expand the use cases.

### Current Status and Path Forward

RigidJS already dominates iteration and sustained workloads: **2-3x faster bulk processing, 1.5-2x faster sustained workloads, 3x better tail latency at scale, 5x less memory, near-zero GC pressure.**

Where JS is currently faster (entity creation at 0.60x at 100k, worsening to 0.12x at N=10; iterator protocol at 0.37-0.83x), these are classified as R&D challenges with specific approaches planned and scheduled across M6-M8. The small-scale data makes hybrid containers (M7) even more critical -- the fixed per-container overhead that is acceptable at N=100k becomes the dominant cost at small N. The engineering goal is >=1x on every operation class at every collection size -- current gaps are problems to solve, not boundaries to accept.

The user's decision framework today:
- **"I create once, iterate many times"** -> RigidJS wins now (even at N=100 via column access at 1.10x)
- **"I create and destroy constantly"** -> JS is faster today; bump allocator (M6) and hybrid container (M7) target this gap
- **"I need predictable latency at scale"** -> RigidJS wins decisively now
- **"I have small collections (N<100)"** -> JS is faster for creation (3-8x); use column access if iteration-heavy, otherwise plain JS until hybrid container (M7)
