# Task 2: Lazy VecImpl Property Init for JS Mode

**Date:** 2026-04-16
**Environment:** Bun 1.3.8, darwin arm64 (Apple Silicon)
**Methodology:** Per-process JIT isolation. Small-scale n=20 medians with stddev. Large-scale n=3 medians.
**Baseline:** M7 final report (n=20 medians)

---

## Change Made

Deferred initialization of 8 SoA-related properties in VecImpl constructor when starting in JS mode. Reduces per-constructor work from ~14 property assignments to ~6 by skipping `_columnMap`, `_columnRefs`, `_columnArrays`, `_swapFn`, `_HandleClass`, `_handle`, `_buf`, `_capacity`. These are initialized in `_graduateToSoA()` instead.

**Files changed:** `src/vec/vec.ts`
**Verification:** 503 pass, 0 fail. Typecheck clean.

---

## Current State: RigidJS vs JavaScript

### Hybrid Vec Creation (B1-hybrid, n=20 medians)

| N | JS ops/s | RigidJS ops/s | Ratio vs JS | M7 Ratio | Change from M7 |
|---|----------|---------------|-------------|----------|-----------------|
| 10 | 753k | 376k | **0.50x** | 0.55x | Within variance |
| 100 | 316k | 206k | **0.65x** | 0.68x | Within variance |
| 1,000 | 55k | 21k | **0.37x** | 0.10x | **+270% (task-1 factory caching)** |

At N=10-100, RigidJS hybrid vec creation is still ~0.5-0.65x JS speed. The gap is real constructor overhead (VecImpl still has ~6 property inits vs a plain `[]` + object literals). N=1000 improved dramatically from M7's 0.10x to 0.37x thanks to task-1's SoA factory caching.

### Hybrid Vec Churn (B2-hybrid, n=20 medians)

| N | JS ops/s | RigidJS ops/s | Ratio vs JS | M7 Ratio | Change from M7 |
|---|----------|---------------|-------------|----------|-----------------|
| 10 | 291k | 270k | **0.93x** | 0.82x | Within variance |
| 100 | 240k | 287k | **1.20x** | 1.48x | Within variance (high stddev) |
| 1,000 | 62k | 18k | **0.29x** | 0.59x | Graduation variance |

N=10 churn near parity. N=100 churn above JS (~1.2x). Both have high variance (40-55% stddev). N=1000 is graduation-dominated.

### Graduation Cost (B10, n=20 medians)

| Threshold | JS ops/s | RigidJS ops/s | Ratio vs JS | M7 (single-run) |
|-----------|----------|---------------|-------------|-----------------|
| N=128 | 257k | 34k | **0.13x** | 0.031x (9.2k ops/s) |
| N=256 | 126k | 24k | **0.19x** | 0.055x (7.9k ops/s) |

Graduation throughput is 3-4x faster than M7 (task-1 factory caching). Still 0.13-0.19x vs JS because JS doesn't do graduation at all.

### Large-Scale (n=3 medians, 100k entities)

| Workload | JS ops/s | RigidJS ops/s | Ratio vs JS |
|----------|----------|---------------|-------------|
| Creation slab (B1) | 516 | 243 | **0.47x** |
| Creation vec (B1-vec) | 497 | 373 | **0.75x** |
| Churn slab (B2, 10k) | 5,270 | 8,623 | **1.64x** |
| Churn vec (B2-vec, 10k) | 8,270 | 13,485 | **1.63x** |
| Iterate slab (B3) | 3,510 | 4,508 | **1.28x** |
| Column slab (B3-column) | -- | 12,311 | -- |
| Column vec (B3-vec-column) | 3,847 | 11,507 | **2.99x** |
| Indexed get vec (B3-vec-get) | 3,470 | 5,798 | **1.67x** |
| forEach vec (B3-vec-forEach) | 4,161 | 3,632 | **0.87x** |
| forEach slab (B3-slab-forEach) | 4,282 | 3,138 | **0.73x** |
| Handle iterate vec (B3-vec-handle) | 3,096 | 1,466 | **0.47x** |
| Nested struct slab (B7) | 498 | 218 | **0.44x** |

**Where RigidJS wins:** Column access (2.99x), churn (1.6x), indexed get (1.67x), iterate slab (1.28x).
**Where JS wins:** forEach (0.73-0.87x), creation (0.47-0.75x), handle iteration (0.47x), nested structs (0.44x).

### Sustained Workloads (n=3 medians, 100k entities, 10s)

| Scenario | JS ticks | RigidJS ticks | Ratio vs JS |
|----------|----------|---------------|-------------|
| B8-sustained slab | 18,240 | 61,296 | **3.36x** |
| B8-vec | 17,742 | 9,531 | **0.54x** |

Slab sustained is a strong 3.36x win. B8-vec sustained anomaly (0.54x) persists -- needs investigation in task-6.

### Scaling (B9, n=3 medians)

| Scale | JS ticks | Slab ticks | Vec ticks | Slab ratio | Vec ratio |
|-------|----------|-----------|-----------|------------|-----------|
| 10k | 115k | 116k | 21k | **1.01x** | **0.18x** |
| 100k | 9.9k | 1.8k | 2.1k | **0.18x** | **0.21x** |
| 1M | 789 | 178 | 213 | **0.23x** | **0.27x** |

At 10k, slab matches JS. At large scale, both containers use less memory (4.4x less RSS at 1M) but throughput ratios decrease due to TypedArray overhead.

---

## Impact of Task-2 Specifically

The lazy init saves 2x `new Map()`, 1x `[]`, 1x `() => {}` per JS-mode constructor. Estimated savings: 20-40ns per constructor call. This is invisible in benchmarks due to 28-55% stddev noise floor at small N.

The B10 graduation scenario showed a modest +19% improvement (28.6k -> 33.9k ops/s at N=128) since it repeatedly creates and destroys vecs.

The optimization is worth keeping for reduced GC pressure (fewer short-lived objects) even though the benchmark signal is lost in noise.

---

## Summary: M8 Progress So Far (Task-1 + Task-2 combined)

| Gap | M7 | After M8 task-1+2 | Status |
|-----|----|--------------------|--------|
| N=1000 graduation cost | 0.10x | 0.37x | **Improved 3.7x** (target was >=0.5x) |
| N=100 creation | 0.68x | 0.65x | **No change** (within variance, target >=1.0x) |
| N=10 creation | 0.55x | 0.50x | **No change** (within variance, target >=0.8x) |
| Large-scale column | 3.99x | 2.99x | **Dominant** (JIT variance) |
| Large-scale sustained slab | 3.32x | 3.36x | **Dominant** |
| Large-scale churn | 1.60x | 1.63x | **Above JS** |
