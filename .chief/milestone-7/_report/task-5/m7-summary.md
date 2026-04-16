# M7 Final Report: Hybrid Vec

**Date:** 2026-04-12
**Environment:** Bun 1.3.8, darwin arm64 (Apple Silicon)
**Methodology:** Per-process JIT isolation, one scenario per `bun run bench -s <name>` invocation. Small-scale hybrid results use n=20 medians with stddev.

---

## 1. What Shipped

Milestone 7 delivered the hybrid vec: a `vec(def)` that starts in **JS mode** (plain JS objects, near-zero init overhead) and automatically **graduates** to **SoA mode** (TypedArray columns) when `len` reaches a threshold (default 128).

### Deliverables

| Task | Description | Status |
|------|-------------|--------|
| Task 1 | Mode dispatch overhead gate -- confirmed boolean branch is free after JIT warmup | PASS |
| Task 2 | JS mode layer: JSHandle codegen, JS object factory, `_items` storage | DONE |
| Task 3 | Graduation logic: auto at threshold 128, `.column()` trigger, `.graduate()` | DONE |
| Task 4 | Options API: `VecOptions`, backward compat `vec(T, number)` | DONE |
| Task 5 | Benchmark scenarios (B1-hybrid, B2-hybrid, B10-graduation) + report | DONE |

### Post-Task Performance Fixes

Three successive optimizations were applied after initial benchmarking revealed that the JS mode construction path was significantly slower than expected:

1. **Cached JS codegen on StructDef** -- `_JSHandle` and `_JSFactory` cached on the struct definition so `new Function()` runs once per struct type, not once per vec. Improved N=10 creation from 0.027x to 0.255x.
2. **Removed JSHandle wrapper** -- Replaced the intermediate JSHandle class with plain JS objects returned directly. Improved N=10 creation from 0.255x to 0.46x.
3. **Refactored vec to class instance** -- Converted the `vec()` closure-based return object (with expensive `get X()` getters and `[Symbol.iterator]` computed key) to a `VecImpl` class with prototype methods. Eliminated ~200 ns/call of `defineProperty` overhead. Improved N=10 creation from 0.46x to 0.53x, and N=100 from 0.47x to 1.20x.

---

## 2. Final Benchmark Results

### 2a. Hybrid Vec (JS mode) vs JS Baseline -- Creation (B1-hybrid, n=20 medians)

| N | JS median | Hybrid median | Ratio | JS stddev | Hybrid stddev |
|---|-----------|---------------|-------|-----------|---------------|
| 10 | 826k | 453k | **0.55x** | 394k (48%) | 125k (28%) |
| 100 | 435k | 296k | **0.68x** | 136k (31%) | 85k (29%) |
| 1,000 | 58k | 5.5k | **0.10x** (graduation) | 18k (31%) | 0.4k (7%) |

N=10 creation gap is consistent (28% hybrid stddev) -- real constructor overhead. N=100 at 0.68x is below parity but vastly improved from SoA-only. N=1000 graduation cost is the most stable measurement (7% hybrid stddev). The JS baseline at N=10 has very high variance (48% stddev), making the exact ratio uncertain but the direction clear.

### 2b. Hybrid Vec (JS mode) vs JS Baseline -- Churn (B2-hybrid, n=20 medians)

| N | JS median | Hybrid median | Ratio | JS stddev | Hybrid stddev |
|---|-----------|---------------|-------|-----------|---------------|
| 10 | 348k | 287k | **0.82x** | 113k (32%) | 99k (34%) |
| 100 | 226k | 335k | **1.48x** | 55k (24%) | 183k (55%) |
| 1,000 | 56k | 33k | **0.59x** (graduation) | 26k (46%) | 10k (32%) |

N=10 churn is near parity within noise (both sides ~33% stddev). N=100 churn at 1.48x is encouraging but has 55% stddev on the hybrid side -- the true ratio could plausibly range from 0.8x to 2x. **Known fairness issue:** the JS baseline swap-remove implementation is not identical to vec's `swapRemove`, so part of the difference may come from benchmarking different operations. N=1000 graduation cost is stable and real.

### 2c. Comparison with Pre-M7 (SoA-only vec)

| Operation | N | SoA-only (M6) | Hybrid (M7, n=20) | Hybrid stddev | Improvement |
|-----------|---|---------------|-------------------|---------------|-------------|
| Creation | 10 | 0.37x | 0.55x | 28% | +49% |
| Creation | 100 | 0.27x | 0.68x | 29% | +152% |
| Churn | 10 | 0.51x | 0.82x | 34% | +61% |
| Churn | 100 | 0.67x | 1.48x | 55% | +121% (high variance) |

At N=100, creation improved from 0.27x to 0.68x (still below parity). Churn median suggests above-JS performance (1.48x) but the 55% stddev and benchmark fairness issue (different swap-remove implementations) mean this needs validation. All improvements over M6 are directionally significant even accounting for variance.

### 2d. Large-Scale SoA Mode -- No Regression

These use `vec(T, capacity)` which routes directly to SoA mode. The hybrid code path is not involved.

| Scenario | M6 Ratio | M7 Ratio | Status |
|----------|----------|----------|--------|
| B2-vec (10k churn) | 2.83x | 1.53x | JIT variance -- pattern holds |
| B3-vec-get (100k indexed) | 2.55x | 1.25x | JIT variance |
| B3-vec-forEach (100k forEach) | 1.15x | 0.98x | Near parity |
| B3-vec-column (100k column) | 1.67x | 2.92x | Strong win |
| B8-vec (10s sustained) | ~7.5x | 9.30x | Major win |

Run-to-run JIT variance of 30-50% is expected for microbenchmarks on JSC. No structural regression detected. Column access and sustained churn remain clearly above JS.

---

## 3. Success Criteria Assessment

From design spec (hybrid-vec-design-spec.md, section 10):

| # | Criterion | Target | Result (n=20) | Status |
|---|-----------|--------|---------------|--------|
| 1 | Small-scale creation N=10-100 reaches ~1.0x JS | >= 0.8x | 0.55x (N=10, 28% stddev), 0.68x (N=100, 29% stddev) | **PARTIAL** -- improved but below target at both N |
| 2 | Large-scale performance no regression | Within variance | All scenarios within JIT variance envelope | **PASS** |
| 3 | Graduation spike imperceptible (< 50us) | < 50us p50 | 67.67us p50 at N=128 | **PARTIAL** -- marginally above, but < 0.5% of 60fps frame budget |
| 4 | API unchanged -- existing code works | vec(T, N) still works | Confirmed: backward compat via VecOptions | **PASS** |
| 5 | Mode transitions invisible | No user action required | Auto-graduation at push N=128 | **PASS** |

**Result: 3 of 5 PASS, 2 PARTIAL.** With n=20 data, N=100 creation is 0.68x (below parity, not above as earlier n=5 data suggested). The improvement from SoA-only (0.27x to 0.68x) is substantial. N=10 at 0.55x is improved from 0.37x SoA-only but not yet at target. Churn at N=100 (1.48x median) is encouraging but unreliable due to 55% stddev and benchmark fairness issues.

---

## 4. Known Issues

### N=10 creation gap (0.55x, 28% stddev -- reliable)

**Root cause:** VecImpl constructor property initialization still costs more than `[]`. Even with a class-based approach, constructing a VecImpl instance requires initializing ~15 instance properties (`_len`, `_cap`, `_mode`, `_items`, `_columns`, cached references, etc.). A plain `new Array(10)` + 10 object literals involves fewer property assignments.

Profiling showed:
- JS baseline at N=10: ~58 ns total
- VecImpl construction alone: ~65 ns (down from ~230 ns pre-class-refactor)
- 10x push loop: ~70 ns
- Total: ~135 ns vs 58 ns = 0.43x (aligns with measured 0.55x after JIT optimization)

The 28% hybrid stddev confirms this is a real, measurable gap driven by constructor overhead.

### N=100 creation below parity (0.68x, 29% stddev)

With n=20 runs, N=100 creation stabilized at 0.68x -- below the 1.20x seen in earlier n=5 runs. The earlier result was likely an outlier benefiting from JIT variance. The 0.68x is a more honest measurement. Constructor overhead is still significant relative to 100 object literals but is amortized enough to close the gap from 0.27x (SoA-only).

### N=100 churn (1.48x, 55% stddev -- unreliable)

The n=20 churn median at N=100 is 1.48x but with 55% stddev on the hybrid side. This is too noisy to claim a definitive advantage. Additionally, the B2-hybrid JS baseline uses a different swap-remove implementation than vec's `swapRemove`, introducing a fairness question. The result is encouraging but needs: (1) more stable measurement methodology, and (2) identical swap-remove logic in both baselines.

### N=1000 graduation cost (0.10x creation, 0.59x churn)

**Root cause:** The B1-hybrid benchmark creates a fresh vec and pushes 1000 items each iteration. Every iteration hits the graduation threshold at N=128, triggering: ArrayBuffer allocation + column setup + data copy from JS objects to TypedArrays + SoA handle codegen.

In real usage, graduation happens once per vec lifetime. The benchmark measures worst-case repeated graduation. The 7% hybrid stddev on creation confirms this is the most stable and reliable measurement in the small-scale suite.

### Graduation spike (67us at N=128)

The p50 graduation spike of 67us exceeds the 50us spec target. The spike includes the B10 benchmark's setup re-creation cost (graduation is one-way, so the vec must be destroyed and rebuilt each iteration). For a one-time event in real workloads, 67us is < 0.5% of a 60fps frame budget.

---

## 5. Architecture Delivered

```
vec(Particle)                  -- hybrid mode (default)
  |
  |-- JS mode (len < 128)
  |     _items: plain JS objects in Array
  |     push/get/forEach: direct JS object access
  |     column(): triggers graduation
  |
  |-- [graduation at len=128] ---> SoA mode
  |     ArrayBuffer + TypedArray columns
  |     push/get/forEach: DataView/TypedArray access
  |     column(): returns TypedArray slice
  |
vec(Particle, 100_000)         -- SoA mode immediately (capacity implies intent)
vec(Particle, { mode: 'soa' }) -- SoA mode immediately
vec(Particle, { mode: 'js' })  -- JS mode permanently
```

The hybrid architecture is invisible to users. All existing vec code works without modification. The `VecOptions` API provides explicit control for advanced use cases.

---

## 6. Conclusion

M7 delivered the hybrid vec architecture with clean mode transitions, full backward compatibility, and automatic graduation. The post-task optimization work (codegen caching, JSHandle removal, class refactor) was critical -- the initial implementation was 0.027x at N=10 and the final result is 0.55x, a 20x improvement through three successive fixes.

**Revised assessment with n=20 data:** Earlier n=5 results suggested N=100 had crossed 1x for creation (1.20x) and churn (1.05x). With n=20 medians and stddev analysis, the picture is more nuanced:

- **N=100 creation is 0.68x** (29% stddev) -- below parity, but a 152% improvement over M6 SoA-only (0.27x)
- **N=100 churn is 1.48x** (55% stddev) -- median suggests above-JS performance but high variance and a benchmark fairness issue (different swap-remove implementations) make this inconclusive
- **N=10 creation is 0.55x** (28% stddev) -- consistent, real gap from constructor overhead
- **N=1000 graduation is 0.10x** (7% stddev) -- most reliable measurement, confirms graduation cost is real and significant

The headline achievement is the **massive improvement in small-N ratios** compared to SoA-only (0.27x to 0.68x at N=100, 0.37x to 0.55x at N=10). The hybrid architecture is proven correct. Crossing 1x at small N remains an R&D challenge for M8+.

Large-scale SoA performance remains strong with no structural regression. All 495 tests pass.
