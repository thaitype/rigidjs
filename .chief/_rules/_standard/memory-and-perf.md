# Memory & Performance Standard

RigidJS exists to eliminate GC pressure. Any code that defeats this purpose is wrong, even if it passes tests.

## Hard Rules

1. **No per-call JS object allocation in hot paths.** Hot paths are: handle field get/set, container `insert`/`push`/`alloc`/`get`/`has`/`remove`, iterator `next`. Allocate once at container creation and reuse.
2. **No `Proxy` for handles.** Use `new Function()` code generation (Elysia Sucrose style). Proxies break JIT inlining.
3. **No closures inside hot-path methods.** Closure creation is an allocation. Pre-bind once at construction.
4. **No array spread / object spread on hot paths.** Both allocate.
5. **DataView only** for mixed-type reads/writes at computed offsets. Do not layer typed arrays (`Float64Array`, etc.) per struct — they force alignment and break the unaligned-layout guarantee.
6. **Declaration-order layout, no padding.** Field offsets are a running sum of field byte sizes in the order declared. Never reorder fields for alignment.
7. **Nested structs are inlined.** Embedding struct `B` inside struct `A` adds `sizeof(B)` bytes at that offset. Never store a pointer/reference instead.

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
