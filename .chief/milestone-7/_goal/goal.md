# Milestone 7: Hybrid Vec

## Objective

Replace the current SoA-only vec with a hybrid vec that starts in JS mode (plain JS objects) and auto-graduates to SoA mode (TypedArray columns) when `len >= threshold`.

## Why

RigidJS vec dominates at large N (2-5x JS) but loses badly at small N (0.08-0.37x JS). The root cause is fixed per-container overhead: ArrayBuffer allocation, OS zero-fill, and `new Function()` codegen. A hybrid vec eliminates this gap by deferring TypedArray allocation until the collection actually needs it.

## Success Criteria

1. Small-scale creation at N=10-100 reaches approximately 1.0x JS (currently 0.08-0.37x)
2. Large-scale performance has no regression vs current SoA vec (2.55x get, 2.83x churn, 1.15x forEach, 1.67x column)
3. Graduation spike is imperceptible (< 50us at default threshold of 128)
4. API is backward-compatible for `vec(T, capacity)` call pattern
5. New options API: `vec(T, { mode, graduateAt, capacity })`

## Scope

**In scope:**
- JS mode storage layer (plain JS objects, JSHandle codegen)
- Auto-graduation logic (push threshold, .column() trigger, .graduate() explicit)
- Options API (mode, graduateAt, capacity)
- Mode dispatch in all vec methods
- Benchmark validation at small and large N

**Out of scope (deferred to M8):**
- RigidError (replacing Error throws)
- Mutation-during-iteration guard (_iterating flag)
- shrinkToFit()
- Batch APIs (pushBatch, insertBatch)

## Key Risk

Mode dispatch overhead (if-branch per method call in SoA mode) could regress large-scale performance. Task 1 is a gate that validates this risk before building the full feature.

## Design Spec

See `hybrid-vec-design-spec.md` in this directory for the full design.
