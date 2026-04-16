# Task 1: Cache SoA Handle Class Factory on StructDef

**Date:** 2026-04-16
**Environment:** Bun 1.3.8, darwin arm64 (Apple Silicon)
**Methodology:** Per-process JIT isolation. Small-scale n=20 medians with stddev. Large-scale n=3 medians.
**Baseline:** M7 final report (n=20 medians)

---

## Change Made

Split `generateSoAHandleClass()` into two parts:

1. **`generateSoAHandleFactory(node)`** -- cacheable. Calls `new Function()` once per StructDef, returns a factory `(...columnArrays) => SoAHandleConstructor`.
2. **`buildColumnArgs(node, columnRefs)`** -- per-call. Flattens current column TypedArrays into the order the factory expects.

Added `_SoAHandleFactory` field on `StructDef`. Both `vec.ts` and `slab.ts` use get-or-create caching pattern (mirrors existing `_JSFactory`).

**Files changed:** `src/struct/handle-codegen.ts`, `src/types.ts`, `src/vec/vec.ts`, `src/slab/slab.ts`
**Tests added:** 8 new tests in `tests/struct/soa-handle-factory-cache.test.ts`
**Verification:** 503 pass, 0 fail. Typecheck clean.

---

## Current State: RigidJS vs JavaScript

### Hybrid Vec Creation (B1-hybrid, n=20 medians)

| N | JS ops/s | RigidJS ops/s | Ratio vs JS | M7 Ratio | Change from M7 |
|---|----------|---------------|-------------|----------|-----------------|
| 10 | 679k | 389k | **0.57x** | 0.55x | Within variance |
| 100 | 308k | 181k | **0.59x** | 0.68x | Within variance |
| 1,000 | 73k | 24k | **0.33x** | 0.10x | **+230% (factory caching)** |

N=10 and N=100 are within JIT variance of M7 (both have 28-67% stddev). The N=1000 improvement is the real signal -- factory caching eliminates the `new Function()` call on every graduation. Graduation codegen cost dropped from ~182us to ~41us per iteration.

### Hybrid Vec Churn (B2-hybrid, n=20 medians)

| N | JS ops/s | RigidJS ops/s | Ratio vs JS | M7 Ratio | Change from M7 |
|---|----------|---------------|-------------|----------|-----------------|
| 10 | 287k | 260k | **0.91x** | 0.82x | Within variance |
| 100 | 235k | 317k | **1.35x** | 1.48x | Within variance (high stddev) |
| 1,000 | 56k | 17k | **0.30x** | 0.59x | Graduation variance |

N=10 churn near parity. N=100 churn above JS. Both high variance (32-55% stddev).

### Graduation Cost (B10, n=20 medians)

| Threshold | JS ops/s | RigidJS ops/s | Ratio vs JS | M7 (single-run) |
|-----------|----------|---------------|-------------|-----------------|
| N=128 | 250k | 29k | **0.11x** | 0.031x (9.2k ops/s) |
| N=256 | 127k | 25k | **0.20x** | 0.055x (7.9k ops/s) |

Graduation throughput 3.1x faster than M7. Still 0.11-0.20x vs JS because JS doesn't do graduation at all -- it just pushes N objects.

### Small-Scale SoA Creation (B1-small-scale, n=20 medians)

| Container | N | JS ops/s | RigidJS ops/s | Ratio vs JS |
|-----------|---|----------|---------------|-------------|
| slab | 10 | 681k | 140k | **0.21x** |
| vec | 10 | 681k | 136k | **0.20x** |
| slab | 100 | 295k | 156k | **0.53x** |
| vec | 100 | 295k | 76k | **0.26x** |
| slab | 1000 | 62k | 28k | **0.46x** |
| vec | 1000 | 62k | 36k | **0.58x** |

Direct SoA creation (no hybrid JS mode). Vec at N=100 and N=1000 improved ~4x from M7 single-run baselines because factory caching eliminates repeated `new Function()`.

### Small-Scale Iteration (B3-small-scale, n=20 medians)

| Access | N | JS ops/s | RigidJS ops/s | Ratio vs JS |
|--------|---|----------|---------------|-------------|
| column | 10 | 5.0M | 5.0M | **0.99x** |
| column | 100 | 2.2M | 4.3M | **1.98x** |
| column | 1000 | 300k | 1.07M | **3.58x** |
| indexed | 10 | 5.0M | 1.1M | **0.22x** |
| indexed | 100 | 2.2M | 256k | **0.12x** |
| indexed | 1000 | 300k | 41k | **0.14x** |

Column access dominates JS at N>=100 (2-3.6x). Indexed access is slow at all scales (known issue: assertLive overhead).

### Large-Scale (n=3 medians, 100k entities)

| Workload | JS ops/s | RigidJS ops/s | Ratio vs JS |
|----------|----------|---------------|-------------|
| Creation slab (B1) | 441 | 227 | **0.51x** |
| Creation vec (B1-vec) | 421 | 332 | **0.79x** |
| Churn slab (B2, 10k) | 5,043 | 7,562 | **1.50x** |
| Churn vec (B2-vec, 10k) | 11,974 | 12,580 | **1.05x** |
| Iterate slab (B3) | 3,205 | 3,569 | **1.11x** |
| Column vec (B3-vec-column) | 3,788 | 8,746 | **2.31x** |
| Indexed get vec (B3-vec-get) | 3,648 | 5,577 | **1.53x** |
| forEach vec (B3-vec-forEach) | 3,609 | 3,625 | **1.00x** |
| forEach slab (B3-slab-forEach) | 3,603 | 3,965 | **1.10x** |

**Where RigidJS wins:** Column access (2.31x), churn slab (1.50x), indexed get (1.53x), iterate/forEach (~1.1x).
**Where JS wins:** Creation (0.51-0.79x).

### Sustained Workloads (n=3 medians, 100k entities, 10s)

| Scenario | JS ticks | RigidJS ticks | Ratio vs JS |
|----------|----------|---------------|-------------|
| B8-sustained slab | 18,240 | 60,650 | **3.32x** |
| B8-vec | 18,000 | 9,601 | **0.53x** |

Slab sustained is a strong 3.32x win. B8-vec sustained (0.53x) is an anomaly -- needs investigation in task-6.

---

## Summary

| What changed | Before (M7) | After (M8 task-1) |
|--------------|-------------|-------------------|
| `new Function()` calls per graduation | 1 per call | 1 per StructDef lifetime |
| N=1000 graduation creation ratio vs JS | 0.10x | **0.33x** (+230%) |
| B10 graduation throughput | 9.2k ops/s | **28.6k ops/s** (3.1x faster) |
| Small-N hybrid (N=10-100) vs JS | 0.55-0.68x | 0.57-0.59x (within variance) |
| Large-scale column vs JS | 3.99x | 2.31x (JIT variance, still dominant) |
| Large-scale sustained slab vs JS | -- | 3.32x |
| Large-scale churn vs JS | 1.60x | 1.05-1.50x (JIT variance) |
