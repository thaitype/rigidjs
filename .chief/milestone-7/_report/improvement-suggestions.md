# R&D Performance Improvement Suggestions

**Source:** M7 final analysis (revised with stable n=20 median benchmark data including stddev)
**Date:** 2026-04-12
**Purpose:** Guide next milestone planning for closing remaining performance gaps

---

## 1. N=10 Creation Gap (0.55x)

### Root Cause

VecImpl constructor property initialization costs more than `new Array(10) + 10x {}`. The class refactor eliminated `defineProperty` overhead but VecImpl still initializes ~15 instance properties per construction. At N=10, construction is the dominant cost -- the 10 push calls are cheap but the VecImpl setup is not.

Stable data (n=20): JS median 826k ops/s (48% stddev), hybrid median 453k ops/s (28% stddev) = **0.55x**. The hybrid side is reasonably consistent (28% stddev) -- the gap is real and driven by constructor overhead, not noise.

### Approaches to Investigate

**A. Lazy property initialization.** Defer initialization of SoA-related properties (`_columns`, `_columnLayout`, `_soaHandle`, graduation state) until graduation actually occurs. In JS mode, these are never read. This could cut constructor cost by 30-40% (5-6 fewer property assignments). Expected: push N=10 from 0.55x toward 0.7x.

**B. VecImpl instance pooling.** Maintain a free-list of dropped VecImpl instances. When `vec(def)` is called, recycle a pooled instance instead of constructing a new one. `drop()` returns the instance to the pool. This eliminates constructor cost entirely for repeated create/drop cycles (common in benchmarks, less common in real code).

**C. Lightweight container for tiny collections.** For N < 16, a specialized "MiniVec" backed by a fixed-size JS array with no graduation machinery could match JS speed. The tradeoff is code complexity and an additional mode transition if the collection grows past 16.

**D. Reduce instance property count.** Consolidate related state into fewer properties. For example, pack `_len`, `_cap`, `_mode`, `_graduated` into a single `_state` object or use bitfields in a single number. Fewer property assignments = faster construction.

### Recommendation

Start with (A) lazy initialization -- lowest-risk change with the most direct impact on the measured bottleneck. If that brings N=10 to ~0.7x, combine with (D) to push toward 0.8x.

---

## 2. N=1000 Graduation Cost (0.10x creation, 0.59x churn)

### Root Cause

The B1-hybrid benchmark creates a fresh vec and pushes 1000 items per iteration. Every iteration triggers graduation at N=128, which includes:

1. ArrayBuffer allocation + OS zero-fill
2. TypedArray column setup (one per flat field)
3. O(128) data copy from JS objects to TypedArray columns
4. SoA handle class codegen via `new Function()` (if not cached on StructDef)
5. Switch internal mode flag + null out `_items`

Steps 1-3 are O(N) and unavoidable. Step 4 is the largest fixed cost.

**Important context:** In real usage, graduation happens once per vec lifetime. The N=1000 benchmark is worst-case by design -- fresh vec + full push cycle each iteration. This makes it a benchmark artifact, not a representative real-world scenario. Still worth optimizing since the benchmark is a valid stress test.

Stable data (n=20): JS median 58k ops/s (31% stddev), hybrid median 5.5k ops/s (7% stddev) = **0.10x** (creation); JS median 56k (46% stddev), hybrid median 33k (32% stddev) = **0.59x** (churn). The creation ratio is highly stable (7% hybrid stddev) -- this is a reliable measurement of graduation cost.

### Approaches to Investigate

**A. Cache SoA handle class on StructDef.** Apply the same caching pattern used for JS codegen. The SoA handle class depends only on the struct layout, not on the vec instance. Caching it eliminates the `new Function()` call from the graduation critical path. This is the single highest-impact fix for graduation cost.

**B. Cache graduation artifacts bundle.** Beyond the handle class, cache the column layout computation, the copy-to-columns function, and the swap function on the StructDef. First graduation for a given struct type pays the full cost; subsequent graduations (other vec instances of the same type) reuse everything.

**C. Amortize graduation differently.** Instead of copying all 128 items at the threshold, copy incrementally: start writing to both JS objects and TypedArray columns once len reaches `graduateAt / 2`. When len hits the threshold, the TypedArrays are already half-populated. This halves the graduation spike at the cost of slightly slower pushes in the "pre-graduation zone."

**D. Accept the benchmark artifact for now.** In real workloads, graduation happens once per vec lifetime. Document clearly and prioritize the N=10 gap instead, which affects more real-world usage patterns.

### Recommendation

Start with (A) -- cache SoA handle class on StructDef. This directly addresses the largest fixed cost in graduation and also benefits `vec(T, capacity)` construction at small N. Follow with (B) to cache the full artifact bundle. (C) adds complexity; defer unless (A)+(B) are insufficient.

---

## 3. N=100 -- Promising but High Variance

n=20 data shows N=100 is improved but results require careful interpretation:

| Operation | JS median | Hybrid median | Ratio | JS stddev | Hybrid stddev |
|---|---|---|---|---|---|
| Creation | 435k | 296k | **0.68x** | 136k (31%) | 85k (29%) |
| Churn | 226k | 335k | **1.48x** | 55k (24%) | 183k (55%) |

At N=100, the VecImpl constructor cost is amortized across enough elements to become less dominant, JS mode push is fast (plain object creation), and no graduation occurs (threshold is 128).

**Creation (0.68x):** Below parity but a massive improvement from 0.07x SoA-only. The 29% stddev means this is a moderately reliable measurement. The gap is real -- constructor overhead is still significant relative to 100 object literals.

**Churn (1.48x):** The median suggests hybrid vec is faster for steady-state push/pop, but the 55% stddev on the hybrid side is very high. The true ratio could plausibly be anywhere from 0.8x to 2x. The benchmark is fair — both sides perform identical swap-remove-from-index-0 operations. The variance is inherent to small-N benchmarking. The honest conclusion is: churn at N=100 is approximately 1x, with too much variance to be precise.

This partially validates the hybrid architecture. Creation is closing the gap but hasn't reached parity. Churn is approximately at parity. The remaining work is pushing the creation crossover point lower.

---

## 4. Indexed get(i) Collapse at Small N (0.11-0.42x)

### Root Cause

Already investigated in M6 task-1: `get(i)` performs `assertLive()` + bounds check per call, which at small N disrupts JIT inline caching. The per-call overhead dominates when the loop body is tiny.

Stable data:

| N | Indexed vs JS |
|---|---|
| 10 | 0.42x |
| 100 | 0.11x |

### Recommended Iteration Paths

- **forEach** -- no per-call overhead, callback-based. Best for most use cases.
- **column()** -- raw TypedArray access. Best for bulk numeric processing (1.77x at N=100, 3.17x at N=1000 in SoA mode).
- **getUnchecked(i)** -- skip assertLive + bounds check. R&D item for users who need indexed access without safety overhead.

The indexed path is not the recommended hot-path API. Column and forEach are the correct tools for iteration-heavy workloads.

---

## 5. SoA Creation Overhead (0.03-0.07x)

SoA vec creation at small N remains very slow due to full ArrayBuffer + codegen setup:

| N | SoA Creation vs JS |
|---|---|
| 10 | 0.03x |
| 100 | 0.07x |

This is expected and is why the hybrid vec exists. Users should use `vec(T)` (hybrid mode, default) for small collections and `vec(T, capacity)` or `vec(T, { mode: 'soa' })` only when they know the collection will be large.

No further R&D needed here -- the hybrid architecture is the solution.

---

## 6. General Suggestions for Next Milestone

### 6a. RigidError + Mutation Guard

Deferred from M7. Currently, use-after-drop throws a generic `Error`. A dedicated `RigidError` class with structured error codes would improve debuggability. Mutation guards (detecting writes to a vec during iteration) would prevent a class of subtle bugs.

This is a correctness improvement, not a performance improvement. Implement only if it can be done without adding overhead to hot paths (the guard check in `push`/`pop` during iteration should be a single boolean test).

### 6b. Hybrid Mode for Slab

Slab has the same small-N creation gap as vec did pre-M7. The hybrid pattern (JS mode at small N, SoA mode after graduation) could be applied to slab. The implementation would be similar: `_items` array of JS objects in JS mode, bitmap + TypedArray columns in SoA mode.

However, slab has additional complexity: the free-list and slot reuse semantics. A JS-mode slab would need a JS-based free-list (simple array of free indices) that graduates to the Uint32Array free-list stack. Evaluate whether the complexity is justified by the usage patterns -- if slab is typically used at large N, hybrid mode may not be worth the code.

### 6c. Bump Allocator

The bump allocator is specified in the design spec but not yet implemented. It provides ultra-fast allocation for arena-style patterns (allocate many, free all at once). With the hybrid architecture in place, a bump allocator could use JS mode for small arenas and graduate to ArrayBuffer for large ones.

### 6d. .iter() Chains

The design spec calls for Rust-style iterator chains: `.iter().filter().map().collect()`. Column iteration in SoA mode shows 1.77-3.17x at N=100-1000, proving that the data layout supports fast iteration. A lazy iterator chain that compiles to a single tight loop via codegen could match or exceed column performance while providing a more ergonomic API.

This is a significant R&D effort. The key challenge is generating a fused loop body from a chain of iterator combinators without per-element closure calls.

### 6e. Batch APIs

`pushBatch(n)` and `insertBatch(data)` would amortize per-call overhead for bulk operations. At N=1000, pushing one at a time means 1000 function calls; a batch API would be a single call with an internal loop over a TypedArray or structured input.

---

## 7. Background Growth via SharedArrayBuffer/Worker

### Problem

Two operations block the main thread with O(N) copies:

1. **Vec grow** (`push()` overflows capacity): allocate new buffer + copy all columns. At 100k entities this costs ~180µs.
2. **Graduation** (JS mode → SoA): allocate buffer + copy JS objects → TypedArray columns. At N=128 this costs ~67µs, and is more expensive per item than grow because it reads JS object properties.

Both are latency spikes during a `push()` call.

### Approach

Use a Worker thread to perform both grow and graduation in the background:

**Background grow:**
1. When `len >= capacity * 0.75`, send a grow request to a background Worker
2. Worker allocates a new `SharedArrayBuffer` at 2x capacity and copies data
3. Main thread keeps pushing to the old buffer (still has 25% headroom)
4. When Worker finishes, main thread swaps to the new buffer seamlessly
5. If main thread fills old buffer before Worker finishes → fall back to blocking grow (same as today)

**Background graduation:**
1. When `len >= graduateAt * 0.75` (e.g. 96 of 128), send graduation request to Worker
2. Worker allocates `SharedArrayBuffer`, copies JS objects → TypedArray columns
3. Main thread keeps pushing to `_items` in JS mode (still fast, ~32 pushes of headroom)
4. When Worker finishes → swap to SoA mode, null out `_items`
5. If main thread hits `graduateAt` before Worker finishes → fall back to blocking graduation

Background graduation is **even more beneficial** than background grow because:
- JS object → TypedArray copy is slower per item (property reads vs TypedArray.set)
- More time to hide in the background
- After swap, all future operations benefit from SoA speed

### API

```ts
vec(Particle, {
  capacity: 1000,
  backgroundGrow: true  // default: auto-detect
})
```

**Default behavior:** `true` when `SharedArrayBuffer` and `Worker` are available (Bun backend), `false` otherwise. Users can override:

```ts
const DEFAULT_BG_GROW = typeof SharedArrayBuffer !== 'undefined'
  && typeof Worker !== 'undefined'
```

`backgroundGrow: false` gives deterministic single-threaded behavior for environments that need it.

### Challenges

- **Push faster than copy:** If user pushes faster than the Worker can copy, old buffer fills up → must block anyway. Mitigation: trigger at 75% to give headroom.
- **Worker pool:** Spawning a Worker per grow is expensive. Need a shared Worker pool (one per process) that handles grow requests.
- **Column view rebuild:** After swap, all TypedArray column views must be rebuilt (same as current grow). Handle re-creation cost applies.
- **Atomics overhead:** SharedArrayBuffer access may add per-read/write overhead from memory barriers. Needs benchmarking.
- **Double memory:** During growth, both old and new buffers are alive. Temporary 2x memory usage.

### Priority

R&D exploration — not next milestone. Target M9 or M10 after core features (RigidError, iter chains, bump) are shipped. The flag design allows it to be added without breaking changes.

---

## 8. Priority Ranking

| Priority | Item | Expected Impact | Confidence | Effort |
|----------|------|-----------------|------------|--------|
| 1 | Cache SoA codegen on StructDef | Fixes N=1000 graduation cost (0.10x, 7% stddev -- reliable) | High | Small |
| 2 | Reduce small-N benchmark variance | N=100 churn is ~1x but 55% stddev makes it imprecise. Explore longer iteration counts or different measurement approach | Medium | Small |
| 3 | Lazy VecImpl property init | Improves N=10 creation from 0.55x toward 0.7x (28% stddev -- moderately reliable) | Medium | Small |
| 4 | Batch push API | Amortizes per-call overhead at all N | -- | Medium |
| 5 | Hybrid slab | Closes slab small-N gap | -- | Medium |
| 6 | .iter() chains | New API surface, large perf opportunity | -- | Large |
| 7 | Bump allocator | New container type | -- | Medium |
| 8 | RigidError + mutation guard | Correctness, not performance | -- | Small |
| 9 | Background grow (SharedArrayBuffer/Worker) | Eliminates grow latency spike for large vecs | -- | Large |
