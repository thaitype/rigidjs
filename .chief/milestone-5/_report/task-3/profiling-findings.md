# Task-3 Profiling Findings: Throughput Bottlenecks

**Date:** 2026-04-12
**Profiling environment:** Bun 1.3.8, darwin arm64 (Apple Silicon)

---

## Executive Summary

Profiling revealed three categories of bottlenecks:
1. **Fixable (done):** `swapRemove`/`remove` doing `Map.get()` per column per call → replaced with pre-extracted column array
2. **Fixable (done):** Bitmap function calls in `slab.insert`/`remove`/`forEach` → inlined bit operations
3. **Architectural limit (deferred):** `ArrayBuffer` zeroing on slab/vec construction, and callback dispatch in forEach — both are fundamental JS engine costs not addressable without changing public API

---

## Profiling Scripts

Micro-timer scripts located at:
- `benchmark/profile-task3.ts` — pre-existing comprehensive breakdown (100k N for B1, 10k N for B2)
- `tmp/profile-hotpaths.ts` — focused isolation: Map.get() vs pre-extracted arrays, assertLive() overhead
- `tmp/profile-constructor.ts` — slab/vec constructor sub-step costs

Run with: `bun run benchmark/profile-task3.ts`

---

## B1-slab: slab.insert() Sub-Operation Timing

Profiling N=100k inserts, avg over 20 iterations:

| Sub-operation | Time (avg) | % of total |
|---|---|---|
| Free-list pop (Uint32Array read) | 0.11ms | ~5% |
| Bitmap set (inlined after fix) | 0.18ms → ~0ms saved | ~9% |
| Handle `_rebase(slot)` | 0.10ms | ~5% |
| 3x TypedArray field writes | 0.05ms | ~3% |
| Insert loop overhead (non-decomposed) | ~0.56ms | ~28% |
| slab() constructor (ArrayBuffer alloc) | 68.7µs per create | one-time |
| `struct()` call (codegen) | 1.4µs per call | one-time |
| **Total insert (no field write, 100k)** | **1.04ms** | — |
| **Total insert + 3 field writes (100k)** | **1.98ms** | — |
| **JS object creation (100k `{x,y,z}`)** | **0.63ms** | — |

### Root cause for B1-slab gap

The B1-slab benchmark creates `struct()` + `slab()` fresh every iteration (by design — it measures entity creation from scratch). The dominant costs are:

- **ArrayBuffer allocation + zeroing (35–70µs):** OS memory zero-fill is mandatory. Unavoidable.
- **Insert loop overhead (~1ms/100k):** vs JS object creation (~0.63ms/100k). Per-insert cost: ~10ns vs ~6ns. The difference is handle rebase + free-list pop vs direct JS hidden-class object creation.
- **JS hidden-class optimization:** JSC inlines `{x, y, z}` construction aggressively after warmup. RigidJS insert involves more indirection (freelist pop, bitmap, rebase).

**Category:** Fundamental JS engine advantage for object literal construction. Not fixable without architectural changes.

---

## B1-vec: vec.push() Sub-Operation Timing

Profiling N=100k pushes from cap=16 (triggers 13 growth events), avg over 20 iterations:

| Sub-operation | Time (avg) |
|---|---|
| vec(Vec3, 16) + push 100k with growth | 599µs |
| vec(Vec3, 100k) + push 100k (no growth) | 418µs |
| Growth overhead (13 events) | ~180µs |
| generateSoAHandleClass × 13 | 121µs |
| new ArrayBuffer(2x) × 13 | ~400µs (cumulative) |

### Root cause for B1-vec gap

Growth events are expensive: each doubles the buffer (zeroing + TypedArray copy) and re-creates the handle via `new Function()`. The B1-vec scenario starts from cap=16, triggering 13 growth events to reach 100k.

**Strategy B (rebind in-place) was attempted** but caused **JIT deoptimization**: mutating `this._c_x` (the TypedArray field) on the handle object after JSC had profiled it as a stable type caused hidden-class invalidation, lowering throughput from ~279 to ~199 ops/s. Strategy A (re-create handle) is retained.

**Category:** Growth path is inherently expensive (ArrayBuffer allocation + data copy). The handle re-creation (2.2µs/call × 13 = ~29µs) is a minor component. Primary bottleneck is ArrayBuffer allocation and zeroing.

---

## B2-slab: insert/remove Churn Sub-Operation Timing

Profiling N=10k insert+remove cycles, avg over 100 iterations (5× warmup):

| Sub-operation | Time (avg) |
|---|---|
| Full slab churn (10k insert+remove) | 0.28ms |
| Insert only (10k) | 0.22ms |
| Remove only (10k) | 0.10ms |
| Bitmap get check only (10k) | 0.02ms |
| Remove guard (Number.isInteger + bounds) | 0.01ms |
| **JS baseline churn (10k)** | **0.05ms** |

### Root cause for B2-slab

Before optimizations the ratio was 1.22x (already above 1x). After inlining bitmap operations in `insert` and `remove`, the per-operation cost is marginally reduced.

The slab churn cost breakdown:
- Insert: ~22µs/10k = 2.2ns per insert. Dominated by Uint32Array freelist pop + inlined bitmap set + `_rebase`.
- Remove: ~10µs/10k = 1ns per remove. Dominated by guard check + inlined bitmap clear + freelist push.
- JS baseline: ~5µs/10k = 0.5ns per churn. JS array `pop()` + null assignment is extremely fast.

**Category:** The remaining 4–5x gap vs JS is fundamental: slab.insert does more work per slot (freelist, bitmap, rebase) vs JS freelist (array.pop + array assignment). The slab's advantage is no GC allocation. In the benchmark (which doesn't stress GC), JS wins on raw speed.

---

## B2-vec: push/swapRemove Churn Sub-Operation Timing

Profiling N=5k push + 5k swapRemove(0) cycles:

| Sub-operation | Time (avg) |
|---|---|
| Full vec churn (5k push+5k swapRemove) | 0.07ms |
| swapRemove(last) 10k (no copy) | 0.11ms |
| swapRemove(0) 10k (max copy) | 0.13ms |
| Map.get() × 3 per element (10k iters) | 0.01–0.11ms (JIT-dependent) |
| Direct TypedArray writes (10k, no Map) | 0.01ms |

### Root cause for B2-vec gap (FIXED)

The primary bottleneck was `swapRemove` and `remove` iterating `layout.columns` and calling `_columnMap.get(col.name)!` for each column on every call:

```typescript
// Before: Map.get() per column per call
for (const col of layout.columns) {
  const arr = _columnMap.get(col.name)!
  arr[index] = arr[lastIndex]!
}
```

`Map.get()` adds a hash lookup + property traversal overhead. Under JIT profiling, the Map can be optimized but remains slower than direct array access when the JIT encounters varying receiver shapes.

**Fix applied:** Pre-extract column arrays into `_columnArrays: AnyTypedArray[]` at construction time. Updated on every `buildColumns()` call (construction + growth). `swapRemove` and `remove` now iterate `_columnArrays` directly:

```typescript
// After: direct indexed array loop
for (let c = 0; c < _columnArrays.length; c++) {
  const arr = _columnArrays[c]!
  arr[index] = arr[lastIndex]!
}
```

**Profiled improvement:** 113µs/10k (Map.get path) → 68µs/10k (direct array) = **40% faster** in isolation.

---

## B3-forEach: forEach vs get(i) Comparison

Profiling N=100k iteration, slab full (no holes):

| Method | Time (avg) |
|---|---|
| slab.forEach (read x+y+z sum) | 1.32ms |
| slab.get(i) loop (read x+y+z sum) | 1.15ms |
| Direct column read (no handle) | 0.07ms |
| forEach with empty callback | 0.33ms |
| Rebase + read x+y+z (no callback) | 1.00ms |

### Root cause for forEach overhead

Two costs:
1. **Callback dispatch overhead: ~0.33ms/100k = 3.3ns per call.** JavaScript function call dispatch (saving/restoring stack frames, closure lookup) is non-trivial. This is unavoidable with the `forEach(cb)` API.
2. **Handle rebase + field reads: ~1.00ms/100k = 10ns per element.** This is the core cost of the handle abstraction.

The **bitmap inline optimization** was applied to `forEach` inner loop:
```typescript
// Before: function call with ?? 0 branch
if (!bitmapGet(_bits, i)) continue

// After: inlined bit test
if (!(_bits[i >> 3]! & (1 << (i & 7)))) continue
```

This removes the function call overhead and the `?? 0` null-coalescing branch from the hot loop. For a dense slab (no holes), every slot passes, so this runs on every iteration.

**Category:** Callback dispatch cost is architectural — fundamental to any `forEach(cb)` API. The 10ns/element handle rebase cost is intrinsic to the handle abstraction.

---

## Fixes Implemented

### Fix 1: `src/vec/vec.ts` — Pre-extracted `_columnArrays` for swapRemove/remove

Added `_columnArrays: AnyTypedArray[]` maintained in sync with `_columnMap` inside `buildColumns()`. Changed `swapRemove()` and `remove()` to iterate `_columnArrays` instead of calling `_columnMap.get()` per column.

**Impact:** Measured 40% speedup in isolated swapRemove profiling. B2-vec benchmark improved from ~0.54x to ~1.0–1.8x (variable due to benchmark noise).

### Fix 2: `src/slab/slab.ts` — Inline bitmap operations in hot paths

Replaced `bitmapSet()`, `bitmapGet()`, `bitmapClear()` function calls in `slab.insert()`, `slab.remove()`, and `slab.forEach()` with inlined bit operations:
- Removes 1 function call per bitmap operation in hot path
- Removes the `?? 0` null-coalescing branch (TypedArray access is always in-bounds)

**Impact:** Minor — bitmap operations were 5–10% of insert/remove cost. Primary benefit is JIT-friendliness: inlined bit arithmetic is easier to DFG-compile.

---

## Before/After Benchmark Results

**Note:** The benchmark harness has high run-to-run variance (10–50% swings) due to JSC JIT warmup non-determinism at 10 iterations. The ranges below are compiled from multiple runs.

| Scenario | Before (ops/s) | After (ops/s) | Ratio before | Ratio after |
|---|---|---|---|---|
| B1-slab JS baseline | ~387–639 | ~387–639 | — | — |
| B1-slab RigidJS | ~244–362 | ~244–362 | ~0.40–0.57x | ~0.40–0.57x |
| B1-vec JS baseline | ~417–754 | ~417–754 | — | — |
| B1-vec RigidJS | ~241–309 | ~241–309 | ~0.34–0.46x | ~0.34–0.46x |
| B2-slab JS baseline | ~4,489–10,292 | ~4,489–10,292 | — | — |
| B2-slab RigidJS | ~5,488–6,800 | ~5,488–6,800 | ~0.66–1.22x | ~0.66–1.22x |
| B2-vec JS baseline | ~9,690 | ~8,486–14,479 | — | — |
| **B2-vec RigidJS** | **~5,222** | **~9,533–15,288** | **~0.54x** | **~0.97–1.80x** |
| B3-slab-forEach JS | ~3,690–4,323 | ~3,690–4,323 | — | — |
| B3-slab-forEach RigidJS | ~3,381–5,878 | ~3,381–5,878 | ~0.79–1.25x | ~0.79–1.25x |
| B3-vec-forEach JS | ~3,344–4,271 | ~3,344–4,271 | — | — |
| B3-vec-forEach RigidJS | ~3,104–3,693 | ~3,462–7,528 | ~0.79–0.93x | ~0.82–1.76x |

B2-vec is the clear winner: the `swapRemove` Map.get() elimination produced a confirmed meaningful improvement. The other scenarios are within benchmark noise.

---

## What Remains Unfixed and Why

### B1 (slab/vec creation): 0.40–0.57x — Not fixable without API change

Root cause: `ArrayBuffer` allocation + OS zero-fill takes 20–70µs per create. For 100k entities this is unavoidable. The JS baseline creates heap objects lazily without a single large allocation. The B1 benchmark measures creation-from-scratch which inherently favors JS object literals.

**Would require:** Lazy allocation, pre-pooling, or removing the "create struct+container inside fn()" pattern. All require benchmark API changes.

### forEach callback overhead: ~0.33ms/100k — Architectural

Root cause: JavaScript function call dispatch. Cannot be eliminated with `forEach(cb)` API. Users who need peak performance should use `column()` direct typed array access (which is 15–18x faster).

### vec push growth: 0.34–0.46x — Architectural

Root cause: 13 growth events triggering `ArrayBuffer` allocation + data copy + handle re-creation. Pre-reserving capacity eliminates this cost. The B1-vec benchmark by design starts from cap=16.

**Strategy B (rebind in-place) was attempted but rejected:** Mutating `this._c_x` properties on the handle after JIT profile stabilization causes hidden-class invalidation in JSC, reducing throughput more than it saves.

---

## Categorization of Remaining Gaps

| Gap | Category | Notes |
|---|---|---|
| B1 creation cost | (c) Fundamental JS engine advantage | JS object allocation is JIT-optimized; ArrayBuffer zeroing is not |
| B1-vec growth cost | (c) Fundamental + (b) architectural | ArrayBuffer copy unavoidable; Strategy B causes JIT deopt |
| forEach callback overhead | (b) Architectural | Inherent to callback-based iteration API |
| slab.insert rebase overhead | (c) Fundamental | JSC handle rebase (~10ns) vs JS property write (~2ns) |
