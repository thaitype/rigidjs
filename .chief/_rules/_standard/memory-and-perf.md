# Memory & Performance Standard

RigidJS exists to eliminate GC pressure. Any code that defeats this purpose is wrong, even if it passes tests.

## Hard Rules

1. **No per-call JS object allocation in hot paths.** Hot paths are: handle field get/set, container `insert`/`push`/`alloc`/`get`/`has`/`remove`, iterator `next`. Allocate once at container creation and reuse.
2. **No `Proxy` for handles.** Use `new Function()` code generation (Elysia Sucrose style). Proxies break JIT inlining.
3. **No closures inside hot-path methods.** Closure creation is an allocation. Pre-bind once at construction.
4. **No array spread / object spread on hot paths.** Both allocate.
5. **Field access uses typed memory views at pre-computed offsets.** Two mechanisms are allowed:
   - **TypedArray subclass views** (`Float64Array`, `Uint32Array`, etc.) — the preferred path. Each field's getter/setter references a specific `TypedArray` subclass directly, captured at codegen time via `new Function()`. Monomorphic access compiles to a single indexed memory load under the JIT. This is the Structure-of-Arrays path used by `slab` from milestone-3 onward.
   - **`DataView` reads/writes** — allowed only when the layout requires reading heterogeneous types at arbitrary byte offsets within a contiguous per-entity slot (the Array-of-Structs path used in milestone-1 and milestone-2). Preserved as a fallback for future container designs if SoA is not viable for a given use case.
   - **Never use a polymorphic `TypedArray[]` indirection** — each getter must capture its specific subclass directly so the JIT can fully specialize.
6. **Memory layout is a single-buffer contiguous region with fields laid out by the layout engine.** Concrete layout rules:
   - **One `ArrayBuffer` per container.** The container owns exactly one backing `ArrayBuffer`. All fields live inside it. `slab.buffer` returns this buffer unchanged.
   - **Structure-of-Arrays (SoA) layout** (milestone-3+): each field occupies a contiguous column sub-range of the buffer. Columns may be reordered from declaration order for natural alignment (`Float64Array` views require 8-byte alignment, `Float32Array` / `Uint32Array` / `Int32Array` require 4, and so on). The layout engine sorts columns largest-element-size first, producing natural alignment with zero padding. Field **declaration order is preserved as the semantic identity** (for field iteration, `struct.fields`, `StructDef._offsets` key order, and error messages); the **physical column order** inside the buffer may differ and is an implementation detail.
   - **Array-of-Structs (AoS) layout** (legacy / milestone-1–2 `DataView` path): fields are laid out in declaration order, no reordering, no padding, each entity is a contiguous slot of `sizeof(struct)` bytes.
   - A struct's `sizeof` is the sum of field byte sizes in either layout. The number is identical across SoA and AoS; only the physical placement differs.
7. **Nested structs are inlined.** Embedding struct `B` inside struct `A` contributes `sizeof(B)` bytes to A's total size. In AoS, that means `B`'s fields occupy contiguous bytes at A's offset. In SoA, `B`'s fields become additional columns of A's buffer with dotted internal keys (e.g. `pos.x`, `pos.y`, `pos.z`) and participate in the same natural-alignment sort as top-level fields. Never store a pointer/reference to a separate buffer.

## Allocation Budget

| Operation                    | Allowed allocations       |
|------------------------------|---------------------------|
| `struct({...})` call         | Unbounded (define-time)   |
| Container creation           | 1 ArrayBuffer + bookkeeping |
| Handle method / field access | **0**                     |
| Iterator `.next()`           | **0** (reuse one handle)  |

## Dependencies

- **Zero runtime dependencies.** `dependencies` in `package.json` stays empty. Dev-only tooling goes in `devDependencies`.
- **Allowed imports:** JS built-ins, `bun:*` modules. Anything else requires chief-agent approval.

## Measuring

- Benchmarks use `Bun.nanoseconds()` and `bun:jsc` `heapStats()` (see spec §7.2).
- Benchmark harness is introduced in a later milestone. For Phase 1a, correctness tests suffice; perf gates are deferred.
