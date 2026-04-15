# Milestone 6 Summary

**Date:** 2026-04-15
**Milestone:** 6 (Performance Investigation and Optimization)
**Environment:** Bun 1.3.8, darwin arm64 (Apple Silicon)

---

## What M6 Set Out to Do

Milestone 6 was a pure-performance milestone: investigate and close the three "closeable" gaps identified at the end of M5.

1. **Task 1:** Investigate and root-cause the `vec.get(i)` iteration collapse at N=100-1000 (was 0.12-0.20x JS, suspected JIT artifact)
2. **Task 2:** Investigate and implement forEach stride optimization (hypothesis: replacing `_rebase(i)` with `_advance()` / `slot++` would reduce handle rebase overhead)
3. **Task 3:** Implement vec churn column-swap optimization (swapRemove was using a generic loop over `_columnArrays`; hypothesis: codegen unrolling would eliminate loop overhead)
4. **Task 4:** Full benchmark re-run with per-process isolation and updated reports

---

## Results Per Task

### Task 1: vec get(i) collapse at N=100-1000

**Status:** Root-caused. No fix applied (issue is structural).

**Findings:**
- Root cause 1: `get(index)` performs per-call `assertLive()` (closure boolean read + branch) plus bounds check (two comparisons + conditional throw). At N=100, this overhead runs 100 times per outer iteration.
- Root cause 2: The benchmark harness `Bun.gc(true)` + `Bun.sleep(100)` between warmup and measurement disrupts JSC's DFG optimization of the closure chain. In a clean JIT state, `get()` at N=100k shows 2.55x over JS.
- The collapse is NOT a codegen bug — DFG does compile the accessor class. The issue is that each `get()` call carries ~3-5ns inherent overhead vs JS's monomorphic inline cache at ~1.5ns/elem.
- **Recommendation shifted to forEach:** At small N in hot loops, use `forEach()` instead of `get(i)`. Column access is fastest for numeric-only workloads.
- No source code changes. Benchmark numbers unchanged.

### Task 2: forEach stride optimization

**Status:** Investigated. Not viable. No code change.

**Findings:**
- `slot++` stride approach (replacing `_rebase(i)` with per-handle increment) is **35-55% SLOWER** than current `_rebase(i)`.
- Root cause: `_rebase(i)` assigns from a loop induction variable (JSC can optimize as direct property write). `slot++` introduces read-modify-write dependency per handle per iteration.
- Flat `_rebaseFlat` (no recursion) shows identical performance — JSC already inlines the 2-level `_rebase` recursion.
- Vec forEach is already at **1.15x JS** in clean JIT state (was reported as 0.85x in M5, that was a JIT-disrupted measurement).
- Remaining overhead vs raw manual loop is purely callback dispatch (~0.45-0.52 ns/elem) — architectural, cannot be eliminated without changing the public API.
- **Decision:** Accept current forEach as optimal for the callback-based API.

### Task 3: swapRemove codegen unrolling

**Status:** Implemented. Major win.

**Before:** `swapRemove` used a generic `for (c < _columnArrays.length)` loop — JSC cannot specialize TypedArray type per column.

**After:** At `buildColumns()` time, `generateSwapFn(arrays)` uses `new Function()` to generate:
```javascript
function unrolledSwap(index, lastIndex) {
  c0[index] = c0[lastIndex];  // each cN is a captured TypedArray
  c1[index] = c1[lastIndex];
  // ...
}
```

Each column's TypedArray is captured directly in the closure, no outer array deref, no loop.

**Results:**
- B2-vec churn: **0.91x → 2.83x** (+1.92x improvement, ~3x speedup of swapRemove itself)
- Micro-isolation: generic loop 2.30-3.92ns/call → `new Function()` unrolled 0.26-3.10ns/call (8-9x faster for 3 columns)
- `generateSwapFn()` called once per construction/growth event — never in hot path

### Task 4: Full suite re-run + reports

**Status:** Complete.

All scenarios executed with per-process isolation. B9-vec latency buffer required a harness fix (cap multiplier 100 → 1000 to accommodate post-M6 vec churn speed improvement). Full results and gap analysis written.

---

## Updated Performance Summary Table

### At N=100k (large collection benchmark)

| Operation | M5 Ratio | M6 Ratio | Notes |
|---|---|---|---|
| Slab column access | ~2.77x | 4.73x | JIT variance — both valid |
| Vec churn (B2-vec swapRemove) | 0.91x | **2.83x** | **M6 Task 3 win** |
| Vec indexed get (B3-vec-get) | 1.72x | 2.55x | Improved with better JIT isolation |
| Slab insert/remove (B2-slab) | 1.15x | 1.10x | Stable |
| Vec column (B3-vec-column) | ~1.67x | 1.67x | Stable |
| Vec forEach (B3-vec-forEach) | 0.85x | **1.15x** | **M6 confirmed above 1x** |
| Slab forEach (B3-slab-forEach) | 0.98x | 0.98x | Near parity — accepted |
| Slab forEach handle (B3-iterate) | 0.77x | 0.77x | Architectural floor |
| Vec for..of (B3-vec-handle) | 0.48x | 0.48x | Iterator protocol — use forEach |
| Slab creation (B1-slab) | 0.52x | 0.52x | Planned: M7 batch insert |
| Vec creation (B1-vec) | 0.08x | 0.08x | Planned: M7 batch insert |
| Nested creation (B7) | 0.42x | 0.45x | Planned: M7 batch insert |

### Sustained Workloads

| Workload | M5 Ratio | M6 Ratio | Notes |
|---|---|---|---|
| B8-slab (100k, 10s) | 2.18x ticks | 2.30x ticks | Stable |
| B8-vec (100k, 10s) | 1.49x ticks | **6.15x ticks** | **M6 Task 3 win** |
| B9-slab 10k | 1.07x | 1.07x | Stable |
| B9-slab 100k | ~1.02x | 1.02x | Stable |
| B9-slab 1M | ~1.14x | 1.14x | Stable |
| B9-vec 10k | N/A | **2.03x** | New — previously buffer overflow |
| B9-vec 100k | N/A | **2.41x** | New |
| B9-vec 1M | N/A | **3.55x** | New |

---

## What's Still Below 1x and Path Forward

### Operations below 1x

| Operation | M6 Ratio | Root Cause | M7 Plan |
|---|---|---|---|
| Slab creation (B1-slab) | 0.52x | ArrayBuffer alloc + `new Function()` codegen cost spread over N inserts | `insertBatch()` API using TypedArray.set per column |
| Vec creation (B1-vec) | 0.08x | Same as above plus growth realloc overhead | `pushBatch()` API; `reserve()` helps but per-push cost remains |
| Nested struct creation (B7) | 0.45x | More fields = more per-insert writes | Batch insert API |
| Slab forEach handle (B3-iterate) | 0.77x | forEach callback dispatch overhead (~0.45ns/elem) is architectural | Accepted; use column() for speed-critical paths |
| Vec for..of (B3-vec-handle) | 0.48x | JS iterator protocol per-call overhead (~2 function calls, GC allocation risk) | Documented as "use forEach or get() in hot paths"; not a priority |

### Accepted floors

- **Slab forEach / vec forEach callback dispatch:** ~0.45-0.52 ns/elem overhead from the callback invocation itself is architectural in a callback-based API. Users needing maximum iteration speed should use `column()` (4.73x) or `get(i)` loop (2.55x).
- **Vec for..of:** 0.48x is expected; JS iterator protocol requires protocol object creation per next() call. Documentation clearly recommends `forEach` or `get(i)` in hot paths.

---

## Recommendations for M7

1. **Batch insert API** (`insertBatch`, `pushBatch`): highest priority. Creation is 0.08-0.52x JS — the single largest remaining gap at large N.
2. **Hybrid container** for small N: creation at N=10 is 0.03-0.11x JS. A JS-object-backed container that graduates to ArrayBuffer above a threshold (e.g., N=64) would close this gap.
3. **B9-vec as standard measurement:** Now that the harness buffer is fixed, B9-vec provides clean per-capacity scaling data comparable to B9-slab.
4. **Vec creation** (`B1-vec`) at 0.08x is anomalously low even vs slab at 0.52x. Vec `push()` with implicit growth involves buffer reallocation at each doubling. A pre-`reserve()` path in B1-vec should be added to separate the "steady-state insert" cost from the "growth realloc" cost.
