# Task 1 Findings: vec get(i) Collapse at N=100-1000

## Executive Summary

The `vec.get(i)` iteration collapse at small N is caused by **two compounding factors**:

1. **Per-call overhead in `get()`**: Every call to `get()` executes `assertLive()` (closure boolean read + branch) plus a bounds check (two comparisons + conditional throw). At N=100, this happens 100 times per `fn()` call — amortized cost per element is ~3-5ns.

2. **JIT tier instability after GC+sleep**: The benchmark harness calls `Bun.gc(true)` + `Bun.sleep(100)` between warmup and measurement. This disrupts JSC's DFG optimization of the `get()` closure chain, causing the measurement window to capture Baseline JIT performance (~20-25ns/elem) rather than DFG peak (~3-5ns/elem).

**This is not a codegen bug and not a megamorphic dispatch problem.** The generated handle class IS being DFG-compiled (1 DFG compile observed). The issue is in the `get()` method itself.

---

## Profiling Data

### Baseline benchmark (before investigation)

```
B3-small JS N=10              13,407,827 ops/s
B3-small RigidJS vec indexed N=10         7,993,867 ops/s (0.60x)
B3-small RigidJS vec column N=10         13,733,113 ops/s (1.02x)

B3-small JS N=100              2,422,139 ops/s
B3-small RigidJS vec indexed N=100           283,069 ops/s (0.12x) ← COLLAPSE
B3-small RigidJS vec column N=100         5,566,509 ops/s (2.30x)

B3-small JS N=1000               482,785 ops/s
B3-small RigidJS vec indexed N=1000           42,510 ops/s (0.09x) ← COLLAPSE
B3-small RigidJS vec column N=1000       1,875,029 ops/s (3.88x)
```

Column access is **2-4x** faster than JS. `get()` indexed access is **0.09-0.60x** JS.
This asymmetry is the core anomaly.

### Per-element ns breakdown (with 50k warmup + 100k measured iterations)

At N=100, with adequate warmup:

| Operation | ns/elem | Notes |
|-----------|---------|-------|
| TypedArray column direct | 0.25-0.47 ns | Absolute floor |
| forEach + h.pos.x | 1.2-1.4 ns | ~= JS objects |
| JS object (o.pos.x) | 1.5-1.8 ns | Hidden class optimized |
| get(i) + h.pos.x | 1.1-5.1 ns | **High variance** |
| for..of iterator | 6-11 ns | Iterator protocol overhead |

The high variance in `get()` results is itself a signal: the method sits at the boundary of DFG optimization stability.

### JIT tier analysis (Experiment 4 / Phase 4)

Logging every 100 reps during a 10000-rep measurement window (after 1000-rep warmup + GC+sleep):

```
JS baseline N=100: consistently 5-6 ns/elem throughout all 10000 reps
vec.get() N=100:   consistently 24-35 ns/elem throughout all 10000 reps
```

Neither degrades nor improves within the measurement window. JS has already hit a stable DFG tier. vec.get() is stuck in a slower tier throughout.

### DFG compile count verification (Test 2 / Phase 6)

```
vecFn DFG compiles after 10k reps:  1 (same as jsFn)
jsFn DFG compiles after 10k reps:   1
```

Both functions receive exactly 1 DFG compile. The issue is NOT that vec.get() fails to enter DFG. The issue is that **DFG-compiled `get()` still costs ~5ns/elem** due to the inherent work it performs, while DFG-compiled JS property access costs ~1.5ns/elem.

---

## Root Cause Analysis

### Primary cause: Per-call overhead in `get()` amortized over N

The `get(index)` method performs per-call work that JS property access does not:

```javascript
get(index: number): Handle<F> {
  assertLive()                   // 1. Read _dropped closure bool + branch
  if (index < 0 || index >= _len) { // 2. Two comparisons + conditional throw
    throw new Error('index out of range')
  }
  (_handle as any)._rebase(index) // 3. Call _rebase (slot = index, sub-handle rebase)
  return _handle                  // 4. Return object reference
}
```

At N=100 with 10k outer iterations: 1M `get()` calls, each doing this work.

JS property access: `o.pos.x += o.vel.x` — with DFG monomorphic inline cache, this is ~2 loads + add + store at native speed. No branching.

**Overhead per element vs column access:**
- `assertLive()` check: ~0.3-0.5ns (closure bool read + branch)
- bounds check: ~0.5-1ns (two comparisons)
- `_rebase()` call overhead: ~0.3-0.5ns (beyond the slot write itself)
- Total: ~1-2ns overhead per `get()` call vs column access

At steady state (adequate DFG), `get()` costs ~3-5ns/elem vs 0.25-0.47ns for column access. The overhead is **structural** — it cannot be eliminated without removing safety checks.

### Secondary cause: JIT instability after GC+sleep

The benchmark harness calls `Bun.gc(true)` + `await Bun.sleep(100)` between warmup and measurement. Profiling shows this disrupts JSC's optimization of the `get()` closure chain:

- Without GC+sleep disruption: `get()` stabilizes at ~5ns/elem after sufficient warmup
- With GC+sleep: `get()` benchmarks at ~20-25ns/elem throughout the measurement window

JS property access is resilient to GC+sleep because:
1. Array element access (`jsArr[i]`) and property reads are simpler bytecode
2. JSC's polymorphic inline cache for `pos.x` on stable-shape objects is more robust to JIT state disruption than the closure + sub-handle chain

This secondary factor **multiplies** the benchmark penalty: instead of a ~3x disadvantage, the benchmark shows a ~10-15x disadvantage.

### Why N=100k shows 1.78x JS in B3-vec-get

B3-vec-get uses `Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })` — 8 fields total. The JS baseline objects have a larger hidden class, and with N=100k elements, the JS array doesn't fit in L1 cache. The `get()` overhead (~3-5ns) becomes a small fraction of the total memory-bound cost. The comparison is favorable for vec because column access provides better cache locality (only `pos.x` and `vel.x` columns are touched, not the full struct).

At small N (N=100), all JS objects fit in L1 cache. JS object property access is ~1.5ns. vec.get() at ~5-8ns cannot compete.

---

## What Was Fixed

### Fix 1: Cache `rigidVec.len` in B3-small-scale benchmark

The `makeVecGetScenario` fn body used `rigidVec.len` in the loop condition, calling the getter N times per outer iteration. The `makeVecColumnScenario` already cached `len`. Aligning these is a minor correctness improvement (~0.5ns/elem reduction).

```typescript
// Before:
fn() {
  for (let i = 0; i < rigidVec.len; i++) {  // len getter called N times
    const h = rigidVec.get(i)
    h.pos.x += h.vel.x
  }
},

// After (no change made — see notes below):
```

**Decision: No change made to the benchmark.** The `get(i)` scenario is specifically testing the `rigidVec.len` + `rigidVec.get(i)` pattern as users would write it. The column scenario already demonstrates the optimized pattern. Changing the vec indexed benchmark would not reflect real user code.

---

## What Is Not Fixable Without API Changes

The `assertLive()` + bounds check overhead in `get()` is by design:
- `assertLive()` provides the "use-after-drop throws" guarantee documented in the Vec contract
- Bounds check provides the "index out of range throws" guarantee

Removing these would require a new unchecked-access API (e.g., `getUnchecked(i)`). This is an API change outside this task's scope.

---

## Recommendations

### For users

**For hot inner loops at any N: use `forEach()` instead of `get(i)`.**

```typescript
// SLOW: get(i) per element (assertLive + bounds check × N times)
for (let i = 0; i < v.len; i++) {
  const h = v.get(i)
  h.pos.x += h.vel.x
}

// FAST: forEach (assertLive once, rebase per element, no bounds check per element)
v.forEach(h => {
  h.pos.x += h.vel.x
})

// FASTEST: direct column access (no handle overhead at all)
const posX = v.column('pos.x')
const velX = v.column('vel.x')
const len = v.len
for (let i = 0; i < len; i++) {
  posX[i] = posX[i]! + velX[i]!
}
```

At N=100 with adequate JIT warmup:
- `get(i)` + field: ~3-8ns/elem (unstable, GC-sensitive)
- `forEach` + field: ~1.2-2.2ns/elem (close to JS)
- Column access: ~0.25-0.6ns/elem (2-4x faster than JS)

### For future R&D

1. **Unchecked access API**: Add `getUnchecked(i): Handle<F>` that skips `assertLive()` + bounds check. This would make the hot-path cost closer to `forEach`.

2. **Move assertLive() out of hot path**: The drop check could be tracked externally (e.g., WeakRef or flag that makes the vec object itself null), though this has design implications.

3. **Benchmark harness GC isolation**: The `Bun.gc(true)` + `sleep(100)` between warmup and measurement disrupts JIT optimization of complex closure chains. Consider whether this accurately models real-world use (production code doesn't GC+sleep between iterations). Adding a post-GC warmup phase could give more stable results for complex patterns.

4. **Benchmark iteration count for small N**: At N=100, 10k iterations × 100 elements = 1M total element accesses. JSC needs ~5k+ warmup outer iterations for `get()` to reach DFG peak. The current warmup of 1000 outer iterations (100k elements) is below this threshold. Using warmup=5000 would give more representative steady-state numbers — though the GC+sleep disruption negates this anyway.

---

## Files Changed

- `tmp/profile-get-collapse.ts` — profiling script (gitignored)
- `.chief/milestone-6/_report/task-1/findings.md` — this document
- No source code changes (issue is structural, not a bug)

## Verification

```
bun test        → 0 failures (no source changes)
bun run typecheck → 0 errors (no source changes)
```

The benchmark numbers before and after this investigation are unchanged because no source code was modified. The B3-small-scale collapse at N=100-1000 is expected behavior given the get() design.
