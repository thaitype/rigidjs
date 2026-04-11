# Task 2 — Shared Types and Layout/Sizeof Computation

## Objective
Introduce the public type surface (`NumericType`, `StructFields`, `FieldType`, `StructDef`) and a pure layout engine that computes `sizeof` and a per-field absolute-offset table for arbitrary (possibly nested) struct definitions. No handle codegen yet, no `struct()` export yet.

## Inputs (read before starting)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_contract/public-api.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-1/_contract/public-api.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` §4.1
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-1/_goal/goal.md`

## Deliverables
- `/Users/thada/gits/thaitype/rigidjs/src/types.ts` — public type declarations:
  - `NumericType` (union of the 8 tokens listed in the contract, in the order `'f64' | 'f32' | 'u32' | 'u16' | 'u8' | 'i32' | 'i16' | 'i8'`)
  - `StructDef<F extends StructFields>` interface with `readonly sizeof: number` and `readonly fields: F` (the interface may carry additional internal-only members in later tasks; do not expose them in milestone-1)
  - `FieldType = NumericType | StructDef<any>`
  - `StructFields = Record<string, FieldType>`
  - A `NUMERIC_SIZES: Record<NumericType, number>` constant (internal, not re-exported from `src/index.ts`)
- `/Users/thada/gits/thaitype/rigidjs/src/struct/layout.ts` — pure functions:
  - `isNumericType(t: FieldType): t is NumericType`
  - `computeLayout(fields: StructFields): { sizeof: number; offsets: ReadonlyMap<string, { offset: number; type: FieldType }> }`
    - Flat numeric fields map directly
    - Nested `StructDef` adds `nested.sizeof` to running offset, and the top-level offset entry for that field points to the nested struct's base (deeper recursion for dotted paths is NOT required at this task — only the top-level field's base offset and its type — nested dotted resolution is a task-4 concern)
  - The function MUST throw on an empty field map (contract requires this; throw an `Error` with a clear message)
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/layout.test.ts` — unit tests:
  - `sizeof` for each of the 8 numeric types in isolation
  - `sizeof({ x: 'f64', y: 'f64', z: 'f64' })` === 24
  - Mixed-type struct sizeof (e.g., `{ a: 'u8', b: 'u32', c: 'f64' }` === 13)
  - Nested: `Particle` from spec §4.1 has `sizeof === 56` and the top-level offsets are `pos=0`, `vel=24`, `life=48`, `id=52`
  - Empty fields throws

## Acceptance criteria
- [ ] `src/types.ts` declares exactly the types listed above; no `any` in signatures that appear in the public surface (internal `StructDef<any>` recursion is allowed and documented with a short comment)
- [ ] `computeLayout` is pure: no `ArrayBuffer`, `DataView`, or `Function` construction
- [ ] `grep -rn "new Function" src/struct/layout.ts src/types.ts` returns nothing
- [ ] `grep -rn "ArrayBuffer\|DataView" src/struct/layout.ts src/types.ts` returns nothing
- [ ] `bun test` passes, with at least the 11 specific assertions listed in Deliverables > tests
- [ ] `bun run typecheck` exits 0
- [ ] `struct` is NOT yet exported from `src/index.ts` (still placeholder from task-1)
- [ ] Empty-fields call throws an `Error`

## Out of scope
- `struct()` function itself (task 3 wraps layout + codegen)
- Handle class / codegen
- Runtime field writes or DataView interaction
- Dotted-path offset lookups for nested fields (task 4)
- Re-exporting anything from `src/index.ts`

## Notes
- Declaration-order, no padding — `_standard/memory-and-perf.md` rule 6.
- `NUMERIC_SIZES` is the single source of truth for byte sizes; do NOT inline the number `8` elsewhere.
- `computeLayout`'s return type uses `ReadonlyMap` so callers cannot mutate it.
- The `offsets` map is internal infrastructure; keep it out of `src/index.ts`.
- File placement: layout computation lives at `src/struct/layout.ts` per `_standard/layout.md`.
