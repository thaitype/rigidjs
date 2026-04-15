# RigidJS Performance Vision

## Internal Engineering Goal

RigidJS aims to be a **complete replacement for JS objects and arrays** across all workloads, not just large numeric collections. Every operation must target **>=1x JS-native throughput** with strictly better GC characteristics.

This is an internal engineering north star. External communication (README, docs) should remain practical and honest about current status.

## Performance Targets

| Operation class | Target vs JS-native | GC target |
|----------------|---------------------|-----------|
| Field read/write | >=1x throughput | 0 GC objects |
| Container creation | >=1x throughput | 1 ArrayBuffer only |
| Iteration (for..of, .iter()) | >=1x throughput | 0 per-iteration allocations |
| Insert/push/alloc | >=1x throughput | 0 per-call allocations |
| Bulk operations (filter, map, reduce) | >=1x throughput | 0 intermediate arrays |

Where RigidJS currently falls short of 1x JS throughput (e.g., struct creation overhead, iterator protocol overhead), these are classified as **R&D challenges to be solved in future milestones** -- not accepted limitations.

## Scope: No Artificial Boundaries

RigidJS is NOT limited to:
- "Large collections only"
- "Numeric data only"
- "Hot paths only"
- "Game engines and simulations only"

RigidJS targets ALL JavaScript workloads where objects or arrays are used. Phase 1 starts with numeric types; Phase 2 adds strings. Future phases should close remaining gaps for general-purpose use.

## Current Limits Are R&D Challenges

The following are known current limits. Each is an R&D challenge for future milestones, NOT an accepted fundamental limitation:

| Current limit | Status | R&D direction |
|--------------|--------|---------------|
| Struct creation slower than `{}` | R&D challenge | Hybrid containers, pre-warmed pools, batch creation APIs |
| Iterator protocol overhead | R&D challenge | JIT-friendly iterator designs, manual loop codegen, compiler plugins |
| DataView overhead vs direct typed array | R&D challenge | SoA layout (solved in milestone-3+), column-native APIs |
| No string support yet | Phase 2 planned | `str:N` inline bytes, `string` JS ref, encode cache |
| No arbitrary JS value storage | R&D challenge | Reference-slot columns, hybrid JS-object-backed containers |
| Single-threaded only | R&D challenge | SharedArrayBuffer, worker-transfer patterns |
| Bun-only runtime | R&D challenge | Feature-detect fallbacks, polyfill DataView paths for other runtimes |

## Future R&D Directions

These techniques should be explored in future milestones to close performance gaps:

1. **Hybrid containers** -- Containers that use JS objects internally when small and graduate to ArrayBuffer layout at a threshold, ensuring >=1x JS speed at all collection sizes.
2. **JS-object-backed containers** -- Containers using the same RigidJS API but backed by plain JS objects, useful when ArrayBuffer overhead exceeds benefit (very small structs, single instances).
3. **Batch APIs** -- `insertBatch(n)`, `pushBatch(data)`, bulk field writes that amortize per-call overhead.
4. **Compile-time codegen** -- Bun macros or build plugins that generate accessor code at compile time instead of runtime `new Function()`.
5. **Column-native operations** -- SIMD-style bulk math on entire columns without per-element handle access.
6. **Zero-copy serialization** -- Direct ArrayBuffer-to-network/disk without marshalling to JS objects.
7. **Adaptive layout** -- Containers that profile access patterns and switch between AoS and SoA dynamically.

## Milestone Planning Principle

When planning milestones, prioritize closing throughput gaps over adding new features. A container that matches JS speed for all operations is more valuable than a container with more features but slower creation.

## Relationship to Design Spec

This file supplements `rigidjs-design-spec-v3.md` (which remains the authoritative product specification and must not be edited). Where the design spec describes current scope boundaries (e.g., "Phase 1: Numeric Types"), this vision document clarifies that those boundaries are delivery phases, not permanent limitations.
