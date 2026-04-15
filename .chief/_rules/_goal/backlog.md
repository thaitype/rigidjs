# RigidJS R&D Backlog

Unscheduled R&D items. Not assigned to any milestone yet. Pick up when relevant or when dependencies are met.

---

## Container References ("handle/reference to another container")

**Problem:** Rust supports `Vec<Vec<f64>>` — a container of containers. RigidJS cannot, because struct fields must be fixed-size numeric types. A slab/vec is not a fixed-size value.

**Desired:** Allow a struct field to reference another container. Enables patterns like:
- Entity with variable-length child list
- Graph/tree structures in contiguous memory
- Nested collections without JS object overhead

**Approach (TBD):**
- Store a fixed-size reference (e.g., `u32` index or handle ID) in the struct field
- The reference points into a shared "container registry" or a specific named container
- Needs ownership/lifetime design — who owns the inner container? What happens on `.drop()`?

**Depends on:** Phase 2+ (string support may inform the variable-length storage design)

**Status:** Backlog — not yet scheduled

---

## Primitive Type Containers (`vec('u32')`, `slab('f64')`)

**Problem:** Currently `vec()` and `slab()` require a `StructDef` from `struct()`. To store a simple list of numbers, you must wrap it: `struct({ value: 'u32' })`, then access via `handle.value`. This is awkward and adds overhead for what should just be a managed `Uint32Array`.

**Desired:** Allow passing a raw numeric type directly:
```ts
const ids = vec('u32')       // like a managed Uint32Array
ids.push(42)                 // no handle, direct value
const v = ids.get(0)         // returns 42 (number), not a handle
```

**Approach (TBD):**
- Detect if argument is a `NumericType` string instead of `StructDef`
- Single-column container with no handle layer — push/get work with raw numbers
- `column()` returns the underlying TypedArray directly (same as today's single-column case)
- Should be near-zero overhead vs raw TypedArray, with RigidJS lifecycle management (`.drop()`, `.reserve()`)

**Depends on:** None — could be implemented independently

**Status:** Backlog — not yet scheduled
