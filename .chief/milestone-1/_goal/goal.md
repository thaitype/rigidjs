# Milestone 1 Goal — Phase 1a: `struct()` Foundation

## Objective

Deliver the `struct()` primitive with full support for all 8 Phase 1 numeric types and nested struct inlining. This is the foundation every container (`slab`, `vec`, `bump`) will build on.

Reference: `.chief/_rules/_goal/rigidjs-design-spec-v3.md` §4.1 and §6.1.

## In Scope

1. **`struct(fields)` builder**
   - Accepts an object literal mapping field names to either:
     - A numeric type token: `'f64' | 'f32' | 'u32' | 'u16' | 'u8' | 'i32' | 'i16' | 'i8'`
     - Another `StructDef` (nested struct)
   - Returns a `StructDef` with `sizeof` and `fields`.

2. **Layout computation**
   - Declaration-order, no padding.
   - `sizeof(nested)` correctly propagates.
   - Offset table computed once at `struct()` call time.

3. **Code-generated handle class**
   - Generated via `new Function()` at `struct()` call time (no `Proxy`).
   - Handle holds a `DataView` and a base offset.
   - Per-field getter/setter emits direct `DataView.getFloat64(off, true)` / `setFloat64(...)` style calls with baked-in constants.
   - Nested struct fields return a sub-handle at the correct offset (no allocation on access — sub-handle is pre-constructed and offset-rebased).

4. **Test harness**
   - `bun:test` wired up.
   - Tests cover: single-type structs for every numeric type; round-trip write/read; sizeof correctness; nested struct layout (Vec3 inside Particle per spec §4.1); little-endian byte layout verification via raw `DataView`.

5. **Minimal container for testing handles**
   - Since `struct()` alone allocates no memory, tests need a way to exercise handles. **In-scope:** a minimal internal test helper (NOT part of public API) that wraps a single-slot `ArrayBuffer` and returns one handle. This helper lives under `src/internal/` or `tests/` and is not exported.
   - **Not** a real `slab()` — just enough to verify handle behavior.

6. **Public API entry**
   - `src/index.ts` exports `struct` and its public types (`StructDef`, `StructFields`, `NumericType`).

## Out of Scope (Deferred)

- `slab()`, `vec()`, `bump()` — future milestones
- `.iter()`, `.mapTo()`, `.drop()` — future milestones
- String field types (`str:N`, `string`) — Phase 2
- Benchmark harness — deferred
- Lint/format tooling — deferred
- CI pipeline — deferred
- Overflow/bounds checking on numeric writes (trust caller for now)
- Type validation at runtime (TS types are the contract)

## Success Criteria

- [ ] `bun test` passes with ≥1 test per numeric type
- [ ] `bun run typecheck` passes
- [ ] `struct({ x: 'f64', y: 'f64', z: 'f64' }).sizeof === 24`
- [ ] Particle example from spec §4.1 has `sizeof === 56` with correct per-field offsets
- [ ] Handle field access is typed as `number` end-to-end (no `any`)
- [ ] Handle accessors do not create a `Proxy` — verified by grepping source
- [ ] No per-access JS object allocation — verified by code review against `_standard/memory-and-perf.md`
- [ ] `src/index.ts` contains only re-exports
- [ ] Design spec (`.chief/_rules/_goal/rigidjs-design-spec-v3.md`) is unchanged

## Non-Negotiables

- No `Proxy` anywhere in the handle path.
- Little-endian byte order on all `DataView` calls.
- Declaration-order layout, no padding.
- Nested structs inline, not referenced.
- Zero runtime dependencies.

## Decisions Deferred to Chief-Agent During Planning

- Exact file split inside `src/struct/` (`struct.ts` vs `layout.ts` vs `handle-codegen.ts`) — follow `_rules/_standard/layout.md` as a starting shape
- Whether to expose `StructDef['offsets']` as a public readonly map or keep it internal — default: keep internal, reconsider when `slab()` needs it
- Exact shape of the `TypeOfField<T>` conditional type — implementation detail
