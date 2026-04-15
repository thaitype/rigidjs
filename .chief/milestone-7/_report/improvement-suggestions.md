# R&D Performance Improvement Suggestions

**Source:** M7 final analysis
**Purpose:** Guide next milestone planning for closing remaining performance gaps

---

## 1. N=10 Creation Gap (0.53x)

### Root Cause

VecImpl constructor property initialization costs more than `new Array(10) + 10x {}`. The class refactor (from closure-based object literal) eliminated the `defineProperty` overhead but VecImpl still initializes ~15 instance properties per construction. At N=10, construction is 71% of total cost.

### Approaches to Investigate

**A. Lazy property initialization.** Defer initialization of SoA-related properties (`_columns`, `_columnLayout`, `_soaHandle`, graduation state) until graduation actually occurs. In JS mode, these are never read. This could cut constructor cost by 30-40% (5-6 fewer property assignments).

**B. VecImpl instance pooling.** Maintain a free-list of dropped VecImpl instances. When `vec(def)` is called, recycle a pooled instance instead of constructing a new one. `drop()` returns the instance to the pool. This eliminates constructor cost entirely for repeated create/drop cycles (common in benchmarks, less common in real code).

**C. Lightweight container for tiny collections.** For N < 16, a specialized "MiniVec" backed by a fixed-size JS array with no graduation machinery could match JS speed. The tradeoff is code complexity and an additional mode transition if the collection grows past 16.

**D. Reduce instance property count.** Consolidate related state into fewer properties. For example, pack `_len`, `_cap`, `_mode`, `_graduated` into a single `_state` object or use bitfields in a single number. Fewer property assignments = faster construction.

### Recommendation

Start with (A) lazy initialization -- it is the lowest-risk change with the most direct impact on the measured bottleneck. If that brings N=10 to ~0.7x, combine with (D) to push toward 0.8x.

---

## 2. N=1000 Graduation Cost (0.10x creation, 0.54x churn)

### Root Cause

The B1-hybrid benchmark creates a fresh vec and pushes 1000 items per iteration. Every iteration triggers graduation at N=128, which includes:

1. ArrayBuffer allocation + OS zero-fill
2. TypedArray column setup (one per flat field)
3. O(128) data copy from JS objects to TypedArray columns
4. SoA handle class codegen via `new Function()` (if not cached)
5. Switch internal mode flag + null out `_items`

Steps 1-3 are O(N) and unavoidable. Step 4 is the largest fixed cost.

### Approaches to Investigate

**A. Cache SoA handle class on StructDef.** Apply the same caching pattern used for JS codegen. The SoA handle class depends only on the struct layout, not on the vec instance. Caching it eliminates the `new Function()` call from the graduation critical path. This is the single highest-impact fix for graduation cost.

**B. Cache graduation artifacts bundle.** Beyond the handle class, cache the column layout computation, the copy-to-columns function, and the swap function on the StructDef. First graduation for a given struct type pays the full cost; subsequent graduations (other vec instances of the same type) reuse everything.

**C. Amortize graduation differently.** Instead of copying all 128 items at the threshold, copy incrementally: start writing to both JS objects and TypedArray columns once len reaches `graduateAt / 2`. When len hits the threshold, the TypedArrays are already half-populated. This halves the graduation spike at the cost of slightly slower pushes in the "pre-graduation zone."

**D. Accept the benchmark artifact.** In real workloads, graduation happens once per vec lifetime. The N=1000 creation benchmark is worst-case by design (fresh vec + full push cycle each iteration). Document this clearly and focus optimization effort on the N=10 gap instead.

### Recommendation

Start with (A) -- cache SoA handle class on StructDef. This directly addresses the largest fixed cost in graduation and also benefits `vec(T, capacity)` construction at small N. Follow with (B) to cache the full artifact bundle. (C) is clever but adds complexity; defer unless (A)+(B) are insufficient.

---

## 3. General Suggestions for Next Milestone

### 3a. Hybrid Mode for Slab

Slab has the same small-N creation gap as vec did pre-M7:

| N | Slab Creation vs JS |
|---|---------------------|
| 10 | 0.12x |
| 100 | 0.21x |

The hybrid pattern (JS mode at small N, SoA mode after graduation) could be applied to slab. The implementation would be similar: `_items` array of JS objects in JS mode, bitmap + TypedArray columns in SoA mode. The graduation trigger would be the same threshold-based approach.

However, slab has additional complexity: the free-list and slot reuse semantics. A JS-mode slab would need a JS-based free-list (simple array of free indices) that graduates to the Uint32Array free-list stack. Evaluate whether the complexity is justified by the usage patterns -- if slab is typically used at large N, hybrid mode may not be worth the code.

### 3b. RigidError + Mutation Guard

Deferred from M7. Currently, use-after-drop throws a generic `Error`. A dedicated `RigidError` class with structured error codes would improve debuggability. Mutation guards (detecting writes to a vec during iteration) would prevent a class of subtle bugs.

This is a correctness improvement, not a performance improvement. Implement only if it can be done without adding overhead to hot paths (the guard check in `push`/`pop` during iteration should be a single boolean test).

### 3c. Bump Allocator

The bump allocator is specified in the design spec but not yet implemented. It provides ultra-fast allocation for arena-style patterns (allocate many, free all at once). With the hybrid architecture in place, a bump allocator could use JS mode for small arenas and graduate to ArrayBuffer for large ones.

### 3d. .iter() Chains

The design spec calls for Rust-style iterator chains: `.iter().filter().map().collect()`. Current `for..of` iteration has protocol overhead (0.48x at 100k). A lazy iterator chain that compiles to a single tight loop via codegen could match or exceed `forEach` performance while providing a more ergonomic API.

This is a significant R&D effort. The key challenge is generating a fused loop body from a chain of iterator combinators without per-element closure calls.

### 3e. Batch APIs

`pushBatch(n)` and `insertBatch(data)` would amortize per-call overhead for bulk operations. At N=1000, pushing one at a time means 1000 function calls; a batch API would be a single call with an internal loop over a TypedArray or structured input.

---

## 4. Priority Ranking

| Priority | Item | Expected Impact | Effort |
|----------|------|-----------------|--------|
| 1 | Cache SoA codegen on StructDef | Fixes N=1000 graduation, improves SoA creation | Small |
| 2 | Lazy VecImpl property init | Improves N=10 creation toward 0.7x | Small |
| 3 | Batch push API | Amortizes per-call overhead at all N | Medium |
| 4 | Hybrid slab | Closes slab small-N gap | Medium |
| 5 | .iter() chains | New API surface, large perf opportunity | Large |
| 6 | Bump allocator | New container type | Medium |
| 7 | RigidError + mutation guard | Correctness, not performance | Small |
