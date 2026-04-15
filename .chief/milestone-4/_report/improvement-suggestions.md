# Milestone-4 Improvement Suggestions

**Date:** 2026-04-12
**Context:** Written after milestone-4 (vec container + slab free-list optimization) landed. Numbers reference milestone-4 benchmarks from `.chief/milestone-4/_report/task-5/benchmark.md` and the supplementary B3-vec-get result from `b3-vec-get-result.md`.

---

## 1. Current Scoreboard

| Scenario | RigidJS / JS | Status |
|---|---:|---|
| B3-vec-column iter+mutate (100k) | **3.43x** | Wins decisively |
| B3-vec-get indexed iter+mutate (100k) | **1.89x** | Wins |
| B3-slab-column iter+mutate (100k) | **3.97x** | Wins decisively |
| B8 sustained p99 (100k, 10s) | **0.36ms vs 0.22ms** | Within floor |
| B8 sustained max-tick | **0.81ms vs 0.88ms** | Wins |
| GC object count (slab 100k) | **~272x fewer** | Wins |
| B3-slab handle iter+mutate (100k) | ~1.6x (JIT-warmed, M3 baseline: 0.88x) | Near parity to win |
| B3-vec-handle for..of (100k) | 0.34x | **Far behind** |
| B2-vec push/swapRemove churn | 0.47x | Behind |
| B2-slab insert/remove churn (10k) | 0.68x | Behind |
| B1-vec push 100k (from cap 16) | 0.34x | Far behind |
| B1-slab entity creation (100k) | 0.24x | Far behind |
| B7 nested entity creation (50k) | 0.28x | Far behind |

**Summary:** Column iteration wins at 3.4-4x JS. Vec indexed `get()` wins at 1.9x JS -- this is the new headline handle-iteration result. `for..of` is 0.34x JS and should not be recommended for hot paths. Entity creation and churn remain weak. Slab free-list optimization had no measurable throughput impact.

---

## 2. Root Cause Analysis of Key Findings

### `for..of` iterator protocol overhead (0.34x JS)

The `for..of` loop on vec calls `Symbol.iterator()` once (allocates one iterator object), then `next()` per element. Each `next()` returns `{ value: handle, done: false }`. JSC cannot optimize this into a counted loop because:

1. The `next()` call is a virtual dispatch through the iterator protocol.
2. The `{ value, done }` result object is allocated per call (standard protocol behavior).
3. The yield boundary prevents inlining the loop body into a tight counted loop.

**Evidence:** Vec indexed `get()` (9,287 ops/s) vs vec `for..of` (1,447 ops/s) = **6.4x gap** on the same data structure, same memory layout, same handle. The only difference is the access pattern.

### Vec indexed `get()` beats slab indexed `get()` + `has()` (1.89x vs ~1.6x JS)

Vec's dense layout means `get(i)` is a direct rebase + TypedArray read with no occupancy check. Slab's `get(i)` must first call `has(i)` (bitmap check + branch), then rebase. The branch is unpredictable when the slab has holes. Even at 100% full, the branch prediction cost is nonzero.

### Creation remains slow (0.24-0.34x JS)

Vec creation from initial capacity 16 to 100k requires ~13 doublings, each allocating a new ArrayBuffer and copying all columns. Slab creation pays bitmap + free-list + rebase per insert. Plain JS `{ x: 1, y: 2 }` is a single hidden-class instantiation that JSC has optimized for 15+ years. This gap is structural and unlikely to close significantly.

### Slab free-list Uint32Array had no measurable throughput impact

B2 slab: 0.69x (M3) -> 0.68x (M4). The Uint32Array replaces `Array.push()`/`.pop()` with indexed writes, but at 10k operations per frame the per-call savings (~1-2ns) are below measurement noise. The benefit is GC-side: the free-list no longer triggers internal Array resizing/GC tracking under sustained churn. This shows up in tail latency, not throughput.

---

## 3. Benchmark Harness Issues

### Cross-scenario JIT contamination

B3-slab showed 1.68x JS in M4 vs 0.88x JS in M3. The JS baseline also shifted (3,597 vs 5,291 ops/s). This makes cross-milestone comparisons unreliable. The cause: all scenarios run in a single process, and accumulated JIT state from earlier scenarios affects later ones.

**Impact:** Cannot confidently compare slab M3 vs M4 numbers. The B3-vec-get result (1.89x) was measured in the same contaminated run and should be verified in isolation.

### Inconsistent JS baselines across scenarios

B2-vec JS baseline (12,661 ops/s) vs B2-slab JS baseline (5,740 ops/s) = 2.2x difference for equivalent workloads. Scenario ordering and JIT warmup state cause this.

---

## 4. Improvement Options (Ordered by Expected Impact)

### Option A -- Per-process benchmark isolation (highest priority, infrastructure)

**What it is:** Run each benchmark scenario in a separate `Bun.spawn()` subprocess. Parent process collects results via JSON on stdout.

**Why it matters:** Eliminates JIT contamination between scenarios. Makes cross-milestone comparisons reliable. Makes ratios trustworthy. Without this fix, every future benchmark discussion starts with "but the JIT state was different."

**Expected impact:** No performance change. Reliability and confidence in all future numbers.

**Effort:** 1 task. Rewrite `benchmark/run.ts` to spawn each scenario in isolation. Each scenario file exports a self-contained runner.

---

### Option B -- `vec.forEach(cb)` internal iteration (high impact, small effort)

**What it is:** A method that iterates internally via a plain `for` loop, calling the user's callback with the rebased handle.

```ts
vec.forEach((h, i) => {
  h.pos.x += h.vel.x
})
```

**Why it's faster than `for..of`:** The loop is a plain counted `for (let i = 0; i < _len; i++)` inside the closure. No iterator protocol, no `next()` dispatch, no `{ value, done }` allocation. JSC can inline the callback if it's monomorphic.

**Expected performance:**

| Scenario | Current | Expected with forEach | Rationale |
|---|---:|---|---|
| Vec handle iteration (100k) | 0.34x JS (for..of) | **1.5-2.0x JS** | Should match or approach indexed `get()` at 1.89x. Closure call overhead is ~1-2ns vs protocol overhead at ~5-8ns. |

**Trade-off:** `forEach` cannot `break` or `return` early (same as `Array.forEach`). For early-exit patterns, users still need indexed loops.

**Effort:** 1 small task. Add method to vec, add to slab too (`slab.forEach(cb)` iterates occupied slots internally). Tests + benchmark scenario.

---

### Option C -- `slab.forEach(cb)` internal iteration (medium impact, small effort)

**What it is:** Same pattern as Option B but for slab. Iterates all occupied slots internally, skipping holes via bitmap check inside the loop.

```ts
slab.forEach((h, slot) => {
  h.pos.x += h.vel.x
})
```

**Why it helps:** Moves the `has()` check + `get()` rebase inside a single function call, avoiding the per-slot function-call overhead of the external `for (i) { if (!has(i)) continue; get(i) }` pattern. The bitmap check becomes a branch inside a tight loop that JSC can optimize.

**Expected performance:** B3 slab handle: 0.88x -> ~1.0-1.2x JS. Modest improvement because the bitmap check is already cheap; the gain is from eliminating the external `has()` + `get()` call overhead.

**Effort:** 1 small task. Fold into the same task as Option B.

---

### Option D -- `.iter()` lazy chain (ergonomics + zero-alloc filter/map)

**What it is:** Spec section 4.5. Lazy iterator with `.filter()`, `.map()`, `.take()`, `.reduce()`, `.collect()`. Single-pass, zero intermediate arrays.

```ts
particles.iter()
  .filter(p => p.life > 0)
  .map(p => p.pos.x)
  .reduce(0, (sum, x) => sum + x)
```

**Performance impact on existing scenarios:** Small. The underlying iteration speed is unchanged. The win is avoiding intermediate array allocations for chained operations -- relevant for B4-style filter chains, not B3-style simple iteration.

**When to do it:** After forEach lands. `.iter()` is an ergonomics layer that works on top of any container.

**Effort:** 2-3 tasks. Iterator builder + chain methods + tests + B4 benchmark.

---

### Option E -- `bump()` arena allocator (niche, fastest possible allocation)

**What it is:** Spec section 4.4. `alloc()` = increment a pointer. No per-item free. Drop everything at once.

**Performance impact:** Dominates B5-style "allocate N temporaries, use them, discard all" scenarios. ~1ns per alloc vs ~5-10ns for slab.insert() or ~10ns for JS object creation.

**When to do it:** After forEach and .iter(). bump is specialized for transient allocation patterns.

**Effort:** 2-3 tasks.

---

### Option F -- `vec.reserve(n)` pre-growth method (small, targeted)

**What it is:** Grow the vec's capacity to at least `n` without pushing entities. Lets users control growth timing.

```ts
const v = vec(Def)        // capacity 16
v.reserve(100_000)        // grow to 100k, no entities yet
// now push 100k without any intermediate doublings
```

**Why it helps:** Eliminates the B1-vec allocationDelta problem (1,722 > 1,000 floor). With `reserve()`, users pre-size once and push is pure pointer-advance + field write. Also useful for batch loading patterns.

**Effort:** Tiny. One method, one test. Fold into a forEach task.

---

## 5. Recommended Milestone-5 Scope

**Primary:**
1. Per-process benchmark isolation (Option A) -- fix the measurement infrastructure first
2. `vec.forEach(cb)` + `slab.forEach(cb)` (Options B + C) -- close the handle iteration gap
3. `vec.reserve(n)` (Option F) -- fix the allocationDelta gate failure
4. Re-run all benchmarks with isolated processes and produce authoritative baseline

**Secondary:**
5. `.iter()` lazy chain (Option D) -- if time permits after forEach lands

**Defer to milestone-6+:** `bump()`, string types, npm publish.

### Rationale

The milestone-4 finding is clear: vec's memory layout is fast (column 3.43x, indexed get 1.89x), but the access patterns we ship (for..of) are slow (0.34x). The priority is to ship fast access patterns (forEach) and fix the benchmark infrastructure so we can trust the numbers. `.iter()` is ergonomics on top of a foundation that already works; forEach is the foundation fix.

### Expected milestone-5 deliverables

1. `benchmark/run.ts` rewritten for per-process isolation
2. `vec.forEach(cb)` and `slab.forEach(cb)` methods
3. `vec.reserve(n)` method
4. B3-vec-forEach, B3-slab-forEach benchmark scenarios
5. Re-run full suite with isolation, produce authoritative numbers
6. `.iter()` lazy chain if scope permits
7. Full benchmark report with before/after forEach comparison

### Performance gates (aspirational, not blocking)

| Scenario | Target |
|---|---|
| Vec forEach iteration (100k) | >= 1.5x JS |
| Slab forEach iteration (100k) | >= 1.0x JS |
| Vec column iteration | >= 3.0x JS (preserve M4 win) |
| Vec indexed get iteration | >= 1.5x JS (preserve M4 win) |
| B1-vec with reserve() allocationDelta | <= 500 |
| B8 slab p99 | <= 1ms (no regression) |

---

## 6. Longer-Term Feature Priority

| Priority | Feature | Rationale |
|---|---|---|
| 1 (milestone-5) | Per-process benchmark isolation | Trust the numbers before optimizing |
| 2 (milestone-5) | `vec.forEach()` + `slab.forEach()` | Close handle iteration gap |
| 3 (milestone-5) | `vec.reserve(n)` | Fix allocationDelta gate |
| 4 (milestone-5) | `.iter()` lazy chain | Ergonomics + zero-alloc filter/map |
| 5 (milestone-6) | `bump()` arena | Niche fast allocator for transient data |
| 6 (milestone-6) | `for..of` on slab | Ergonomics (low priority given forEach) |
| 7 (milestone-7+) | String types | Phase 2 of design spec |
| 8 (future) | npm publish + semver | When API stabilizes |
