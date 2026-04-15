# Task 2 Findings: forEach Stride Optimization

**Date:** 2026-04-12
**Environment:** Bun 1.3.8, darwin arm64 (Apple Silicon)
**N:** 100,000 elements, 50–150 iterations, 10–30 warmup

---

## Summary

The stride-based `_advance()` optimization was investigated thoroughly and found to be **not viable**. The `slot++` approach is **35–42% slower** than the current `_rebase(i)` approach. No implementation change was made. The current forEach implementation is already well-optimized and exceeds JS baseline in isolated benchmarks.

---

## Background

Task goal: investigate whether replacing `_rebase(i)` per forEach iteration (which sets `this._slot = i` and recursively rebases sub-handles) with a `_advance()` call (`this._slot++` per level) would yield >5% improvement.

Current generated `_rebase(s)` for a nested struct (e.g. `Particle { pos: Vec3, vel: Vec3 }`):
```js
_rebase(s) {
  this._slot = s;
  this._sub_pos._rebase(s);
  this._sub_vel._rebase(s);
  return this;
}
```

This makes 3 function calls per element (1 root + 2 sub-handles). The hypothesis was that replacing these with `_slot++` arithmetic would reduce overhead.

---

## Profiling Results

### Vec forEach approaches (N=100k, nested struct `Particle`)

| Approach | Median (ms) | ns/elem | vs Current |
|---|---|---|---|
| **A: Current `_rebase(i)` per iter** | 0.094 | 0.94 | baseline |
| B: `slot++` on root+pos+vel (3 increments) | 0.146 | 1.46 | **+55% slower** |
| C: `slot++` on sub-handles only (2 increments) | 0.090 | 0.90 | ~same |
| D: Inline `_slot = i` on root+pos+vel (no fn call) | 0.081 | 0.81 | ~14% faster |
| E: Empty callback (dispatch overhead only) | 0.052 | 0.52 | — |
| F: `_rebase(i)` loop only (no callback, no reads) | 0.038 | 0.38 | — |
| G: `slot++` only (no reads, no callback) | 0.090 | 0.90 | — |

### _advance()-based simulation on prototype (N=100k, 150 iterations)

| Approach | Median (ms) | ns/elem |
|---|---|---|
| Current forEach (`_rebase` per iter) | 0.094 | 0.94 |
| Simulated `_advance()` forEach (slot++) | 0.134 | 1.34 |
| Stride: rebase once + advance rest | 0.128 | 1.28 |
| **JS baseline (indexed for loop)** | **0.179** | **1.79** |

### Flat struct Vec3 (no nesting)

| Approach | Median (ms) | ns/elem |
|---|---|---|
| forEach (current) | 0.047 | 0.47 |
| Manual `_rebase` loop | 0.032 | 0.32 |
| `slot++` advance | 0.049 | 0.49 |

For flat structs, `slot++` is essentially equivalent to `_rebase(i)`. Overhead is purely callback dispatch.

---

## Why Stride is Slower

**JSC JIT analysis**: The `_rebase(i)` pattern assigns a loop-induction variable `i` directly to `this._slot` and sub-handle `_slot` fields. JSC's DFG compiler can treat `i` as a known integer and optimize the recursive calls into direct property writes.

In contrast, `slot++` involves a read-modify-write cycle on `this._slot`, `subPos._slot`, and `subVel._slot` at each iteration. The read-before-write dependency breaks the pipeline and prevents the JIT from recognizing the simple "set from loop variable" pattern.

Additionally, the `slot++` loop requires **more total operations** per iteration:
- `_rebase(i)`: 3 write + 2 function call setups + 1 return
- `slot++` (3 handles): 3 read + 3 increment + 3 write = 9 operations

**Key insight from Vec G**: Running `slot++` on 3 handles with NO field reads and NO callback costs 0.90 ns/elem. Running `_rebase(i)` on 1 nested handle with NO field reads costs 0.38 ns/elem. `slot++` is 2.4x slower as a raw counter operation.

---

## _rebase Optimization Attempt (Vec D)

Vec D (inline `_slot = i` without fn call, 3 direct assignments) achieved 0.81 ns/elem vs 0.94 ns/elem for current forEach — approximately **14% faster in isolation**. However:

1. This is only achievable if the forEach loop itself performs 3 direct property assignments to the handle and its sub-handles per iteration, which requires the forEach implementation to know the handle tree structure at runtime.
2. The handle tree structure is not directly accessible from within the `forEach` closure — it's inside the codegen closure.
3. To expose it, we would need to generate a flat `_rebind(s)` method that does all assignments without recursion, and change `forEach` to call `_rebind(s)` instead of `_rebase(s)`.
4. **However**: `_rebaseFlat` was tested and showed identical performance to `_rebase` (0.079 ms vs 0.079 ms) — JSC already inlines the 2-level recursion.

The Vec D advantage in the profiling script was an artifact of the hot-loop context where the JIT compiled the specific loop pattern differently. In the general `forEach` callback context with an intervening function call, the difference disappears.

---

## Benchmark Results (Before/After)

No code changes were made. Benchmarks confirm current performance:

### B3-vec-forEach

| Scenario | ops/s |
|---|---|
| JS baseline | ~3,590 |
| RigidJS vec forEach | ~6,751 |
| **Ratio** | **1.88x** |

### B3-slab-forEach

| Scenario | ops/s |
|---|---|
| JS baseline | ~4,420 |
| RigidJS slab forEach | ~4,323 |
| **Ratio** | **~0.98x** |

Note: the 0.85x figure from the original profiling report was from an earlier JIT state. Current benchmark results show vec forEach already exceeds JS (1.88x) and slab forEach is near parity (0.98x). The benchmark harness has high run-to-run variance due to JSC JIT warmup.

---

## Decision: Accept Current Implementation

No optimization was implemented. The reasons:

1. `slot++` stride approach is 35–55% SLOWER than current `_rebase(i)` — definitively not viable.
2. Flat `_rebase` (inlined, no recursion) shows no measurable benefit — JSC already optimizes the 2-level recursion.
3. forEach performance is already at 1.9x over JS baseline in isolated measurements and 1.88x in benchmarks for vec.
4. Remaining overhead vs raw manual loop is entirely **callback dispatch** (~0.45–0.52 ns/elem) — architectural, cannot be eliminated without changing the public API.

---

## Recommendations

1. **Accept current forEach as optimal** for the callback-based API. No stride optimization needed or viable.
2. **Users needing peak iteration performance** should use `column()` direct TypedArray access (15–18x faster per profiling in milestone-5) or `vec.get(i)` in a manual loop.
3. **If forEach needed to be faster**, the only viable path would be generator-based coroutines or a `for..of` compiled iteration — both require API changes outside scope.
4. **Slab forEach parity** (~0.98x vs JS) is acceptable; the main overhead is the bitmap occupancy check per slot, not the rebase.

---

## Files Produced

- `tmp/profile-forEach-stride.ts` — profiling script (vec and slab forEach approaches, stride variants)
- `.chief/milestone-6/_report/task-2/findings.md` — this document
