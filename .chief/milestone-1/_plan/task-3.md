# Task 3 — Code-Generated Handle Class for Flat Numeric Structs

## Objective
Implement the `new Function()`-based handle class generator for **flat (non-nested) numeric structs** and wire it into a first working `struct()` function. Also provide a minimal internal single-slot test helper so handle round-trips are exercisable. Nested struct handle support is deferred to task-4.

## Inputs (read before starting)
- Everything from task-2 (types + layout)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md` (especially rules 1, 2, 3 and the allocation budget table)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` §6.1 (Handle Design)
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-1/_contract/public-api.md` (handle behavior guarantees 1–3)

## Deliverables
- `/Users/thada/gits/thaitype/rigidjs/src/struct/handle-codegen.ts`
  - Exports an internal `generateHandleClass(fields, offsets)` function that returns a constructor of the form `new Ctor(view: DataView, baseOffset: number)`.
  - Uses `new Function(...)` (NOT `eval`, NOT `Proxy`) to build a class whose prototype has a getter and setter per numeric field.
  - Each getter/setter body is a single `DataView.getXxx(this._view, this._off + <CONST>, true)` / `setXxx(..., true)` call — all constants (offset, method name) baked into the generated source string. Little-endian `true` is hard-coded in every call.
  - For this task, **throw a clear `Error`** if any field is a nested `StructDef` — that case is task-4. The error message should mention "nested structs not yet supported in task-3".
  - Internal (not re-exported from `src/index.ts`).
- `/Users/thada/gits/thaitype/rigidjs/src/struct/struct.ts`
  - Exports `struct<F extends StructFields>(fields: F): StructDef<F>`.
  - Calls `computeLayout`, calls `generateHandleClass` (for now: flat-only), and returns a `StructDef` object carrying:
    - `readonly sizeof`
    - `readonly fields`
    - Internal-only: the generated handle constructor and the offsets map (typed via an internal symbol or underscore-prefixed property; not part of the contract)
  - Throws on empty fields (delegate to `computeLayout`).
  - The returned handle-class reference is used by the test helper below.
- `/Users/thada/gits/thaitype/rigidjs/src/internal/single-slot.ts`
  - Internal, NOT re-exported from `src/index.ts`.
  - Exports a test-only helper `createSingleSlot<F>(def: StructDef<F>)` that:
    - Allocates one `ArrayBuffer` of size `def.sizeof`
    - Constructs one `DataView` over it
    - Constructs one handle at base offset 0 via the `StructDef`'s internal handle constructor
    - Returns `{ handle, view, buffer }`
  - Used only by tests in milestone-1. Do not reference from `src/index.ts`.
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/handle-flat.test.ts`
  - Round-trip write/read for each of the 8 numeric types in isolation, using `createSingleSlot`
  - Mixed-type flat struct round-trip (`{ a: 'u8', b: 'u32', c: 'f64' }`) — write values, read them back
  - Raw-DataView byte verification for at least one test (e.g., write `0x12345678` as `u32` at offset 0, assert `view.getUint8(0) === 0x78` to prove little-endian)
  - A test that confirms calling `struct({})` throws
  - A test that confirms calling `struct({ nested: Vec3 })` (with a nested def) throws the task-3 "not yet supported" error

## Acceptance criteria
- [ ] `grep -rn "Proxy" src/` returns zero matches
- [ ] `grep -rn "new Function" src/struct/handle-codegen.ts` returns at least one match (codegen is actually used)
- [ ] `grep -rn "true)" src/struct/handle-codegen.ts` shows every DataView call passes `true` for little-endian (reviewer check; at minimum the generated source template contains `, true)`)
- [ ] `bun test` passes all new tests, including 8 per-type round-trips
- [ ] `bun run typecheck` exits 0 with zero errors
- [ ] Handle field access is typed as `number` in the tests (no `as any` casts inside test assertions for numeric reads)
- [ ] `createSingleSlot` is NOT exported from `src/index.ts`
- [ ] `struct({})` throws
- [ ] Flat `struct()` returns an object where `sizeof` and `fields` are readonly (TS-level `readonly`)

## Out of scope
- Nested struct handle support (task 4)
- Any container (`slab`, `vec`, `bump`)
- Iterators, `.drop()`, strings
- Public re-export of `struct` from `src/index.ts` (task 5)
- Benchmark / perf measurement

## Notes
- Generated function source should resemble spec §6.1 but with `, true` appended to each DataView call. Example shape for a field `x` at offset 0 of type `f64`:
  ```
  get x(){return this._v.getFloat64(this._o+0,true)}
  set x(v){this._v.setFloat64(this._o+0,v,true)}
  ```
- The generator should store `this._v` (DataView) and `this._o` (base offset) once in the constructor. These are implementation detail names — not part of any contract, free to rename.
- No per-access allocation: getters/setters must not create arrays, objects, or closures at call time. Allocation budget table in `_standard/memory-and-perf.md` is the enforcement rule.
- Do NOT use template literal tagged functions or regex in hot paths. Codegen happens once, at `struct()` call time — that one-time cost is unbounded per `_standard/memory-and-perf.md`.
- The internal handle constructor can be attached to the `StructDef` via a non-enumerable / underscore-prefixed field (e.g., `_Handle`). The contract explicitly says implementation detail names may change.
- Keep `src/struct/handle-codegen.ts` free of DataView runtime logic — it only emits source strings and calls `new Function`.
