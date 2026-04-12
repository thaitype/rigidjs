# Milestone-4 Summary — Vec + Slab Free-List Optimization

**Date:** 2026-04-12
**Status:** Complete
**Benchmark report:** [.chief/milestone-4/_report/task-5/benchmark.md](./task-5/benchmark.md)

---

## What Shipped

### 1. `vec(def, initialCapacity?)` growable container

A new container type alongside `slab`. Vec provides a growable, ordered, densely-packed container backed by a single `ArrayBuffer` using the same SoA + TypedArray infrastructure from milestone-3.

**Public API added (re-exported from `src/index.ts`):**
- `vec(def, initialCapacity?)` — create a vec, default capacity 16
- `vec.push()` — append entity, returns shared handle, grows 2x on overflow
- `vec.pop()` — remove last entity
- `vec.get(index)` — access entity by dense index 0..len-1
- `vec.swapRemove(index)` — O(1) removal (swaps with last, decrements len)
- `vec.remove(index)` — O(n) order-preserving removal via `copyWithin`
- `vec.len` — current number of live entities
- `vec.capacity` — current buffer capacity
- `vec.clear()` — reset len to 0, capacity unchanged
- `vec.drop()` — release the buffer
- `vec.buffer` — access the underlying `ArrayBuffer`
- `vec.column(name)` — get pre-built TypedArray column view
- `Symbol.iterator` — `for..of` support yielding shared handle per element
- `Vec<F>` type exported for type-level usage

**Design decisions (documented):**
- Handle column refs update via `_rebind()` on growth — no handle invalidation on growth, but column `TypedArray` refs returned by `column()` are invalidated.
- Iterator is a custom iterator object (not a generator) allocated once per `for..of` call. Single iterator allocation per loop.
- Buffer grows 2x on push overflow. Columns copied via `TypedArray.set()`.

### 2. Slab free-list optimization (Uint32Array)

The slab's JS `Array` free-list was replaced with a pre-allocated `Uint32Array` stack with a `_freeTop` pointer. This eliminates GC tracking of the free-list array itself under churn. The throughput impact is within noise (B2 slab: 0.68x JS in M4 vs 0.69x in M3), but the GC-side benefit is real: the free-list no longer generates GC-tracked objects during sustained churn.

### 3. New benchmark scenarios

Five new scenarios added under `benchmark/scenarios/`:
- `b1-vec-creation.ts` — vec push 100k from initial capacity 16
- `b2-vec-churn.ts` — vec push/swapRemove churn (10k ops/frame)
- `b3-vec-handle.ts` — vec `for..of` handle iteration over 100k
- `b3-vec-column.ts` — vec column TypedArray iteration over 100k
- `b3-partial.ts` — 50%-full slab vs 100%-packed vec vs JS

All scenarios use only the public API (`import { struct, slab, vec } from '../../src/index.js'`).

---

## Key Performance Outcomes

| Scenario | Actual result | vs target |
|----------|---------------|-----------|
| Vec column iteration (B3-vec-column) | **3.43x JS** | ≥ 2.5x JS — PASS |
| Vec push 100k (B1-vec) | 0.34x JS | ≥ 0.50x — Miss |
| Vec handle iteration (B3-vec-handle) | 0.34x JS | ≥ 0.90x — Miss |
| Vec swapRemove churn (B2-vec) | 0.47x JS | ≥ 0.80x — Miss |
| B3-partial: vec vs 50%-slab | vec 0.35x slab | vec ≥ 1.5x slab — Miss |
| Slab B2 after free-list fix | 0.68x JS | ≥ 0.80x — Miss |
| B8 slab p99 no regression | **0.3606ms** | ≤ 1ms — PASS |

**The headline win:** Vec's column API (3.43x JS) matches and slightly exceeds the slab column result. For any workload that uses `vec.column()` for hot loops, vec is the fastest option in the library.

**The headline finding:** `for..of` iterator protocol overhead is substantial. Vec handle iteration via `for..of` is 0.34x JS — significantly worse than the slab's plain-indexed handle iteration (0.88x JS in M3). The `for..of` protocol's per-element `next()` call prevents the JIT from seeing a simple counted loop. This affects B3-vec-handle and B3-partial (where vec was expected to win but lost to slab).

**Practical guidance added to docs:** Use `vec.column()` for performance-critical inner loops. Use `for (let i = 0; i < vec.len; i++) { vec.get(i) }` if handle access is needed. Reserve `for..of` for ergonomic code where throughput is not the primary concern.

---

## What Was Deferred

Per the milestone-4 goal, the following remain out of scope for milestone-5+:

- **`.iter()` lazy chain** (filter/map/take/reduce) — milestone-5
- **`bump()` arena allocator** — milestone-5+
- **`slab.forEach()`** — milestone-5
- **`for..of` on slab** — milestone-5 (requires occupancy-checking iterator logic)
- **B4/B5/B6 benchmark scenarios** (require `.iter()`, `bump`)
- **Sustained-load vec benchmark (B8-vec equivalent)** — deferred; meaningful test requires `.iter()` for idiomatic hot-path
- **String field types** — Phase 2
- **CI regression gates** — deferred
- **npm publish** — deferred

---

## Recommendations for Milestone-5

1. **Fix `for..of` performance before committing to it as the ergonomic API.** The iterator protocol adds 3x overhead vs plain indexed access. Options:
   - Option A: Add `vec.forEach(cb)` that uses a plain `for` loop internally — avoiding `for..of` protocol while keeping ergonomic access.
   - Option B: Document `for..of` as "ergonomic, not hot-path" and make `vec.get(i)` in a `for` loop the recommended pattern. Add a lint rule or doc note.
   - Option C: Profile whether a custom `[Symbol.iterator]()` with specialized JIT hints can close the gap.

2. **Add B3-vec-get benchmark.** Measure `for (let i = 0; i < vec.len; i++) { const h = vec.get(i); h.pos.x += h.vel.x }` explicitly so users see the difference between indexed `get()` and `for..of`.

3. **Revisit B3-partial with `vec.column()`** to produce the "receipts" result that was missed: vec column over 100k slots should be strictly faster than slab iteration over 200k slots with `has()` checks.

4. **Ship `.iter()` lazy chain** as the primary deferred item. This enables B4/B5/B6 benchmark scenarios and provides a composable API for filtering, mapping, and reducing over vec/slab.

5. **Re-evaluate the B1-vec allocationDelta gate.** The ≤1,000 floor was written assuming pre-sized containers. Either raise the floor for the growth scenario or add a gate for "pre-sized vec allocationDelta ≤ 1,000" specifically.

6. **Consider a `vec.reserve(n)` method** to pre-grow capacity without pushing entities. This gives users control over the growth timing and avoids allocationDelta spikes during setup.

---

## Test Coverage

340 tests pass across 15 files. The milestone-4 vec implementation has full correctness coverage including:
- push/pop/get/swapRemove/remove semantics
- 2x growth doubling correctness
- `for..of` iterator handle sharing invariant
- column() TypedArray view correctness
- drop() use-after-drop guard
- handle reuse across push/get/iterator

`bun test` exits 0. `bun run typecheck` exits 0.
