# Task 6 — Public Type Hardening

## Objective

Make `Handle<F>` resolve to a fully-typed structural mapped type at the public API boundary so users never need to write shadow interfaces or `as unknown` casts. This fulfills the long-standing promise in `_rules/_standard/typescript.md` that `typeof Vec3.handle.x === number` flows from `'f64'`.

This task is a **minimal public-type hardening pass**. Internal implementation (including existing `as any` / bridge casts) is explicitly OUT OF SCOPE. The rule is: no `any`/`unknown`/casts at the **public boundary**; inside the lib, whatever works is fine.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md` — especially the "Field types flow through to the handle" example
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_contract/public-api.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_contract/public-api.md`
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-6.md` (this file)
8. Existing source: `src/types.ts`, `src/struct/struct.ts`, `src/slab/slab.ts`, `examples/particles.ts`, `tests/public-api/milestone-2.test.ts`

## Scope Guardrails

- **Public boundary:** zero `any`, zero `unknown`, zero casts in user-facing code.
- **Internal code:** existing `as any` / `as unknown as Handle<F>` / `_Handle?` etc. may stay as-is. Do not touch them unless required.
- **Runtime:** no runtime code changes. This is a pure type-level refinement. Any line that executes at runtime must be byte-identical after your edit (except for the example).
- **Tests:** do not mass-edit existing `as any` in tests. Leave white-box internal pokes alone.

## Deliverables

### 1. `src/types.ts` — recursive `StructFields` + `Handle<F>` mapped type

Replace the current `FieldType` alias and `StructFields` type with a recursive interface so nested `StructDef` inference does not collapse to `any`:

```ts
export type NumericType = 'f64' | 'f32' | 'u32' | 'u16' | 'u8' | 'i32' | 'i16' | 'i8'

/**
 * Recursive map of field names to numeric tokens or nested StructDefs.
 * Interface form is required so the self-reference resolves cleanly.
 */
export interface StructFields {
  readonly [key: string]: NumericType | StructDef<StructFields>
}

/** Kept for backwards compatibility of existing internal imports. */
export type FieldType = NumericType | StructDef<StructFields>

export interface StructDef<F extends StructFields> {
  readonly sizeof: number
  readonly fields: F
  /** @internal Generated handle constructor — implementation detail. */
  readonly _Handle?: new (view: DataView, baseOffset: number, slot: number) => object
  /** @internal Offset table — implementation detail. */
  readonly _offsets?: ReadonlyMap<string, { offset: number; type: FieldType }>
}
```

Then add the public `Handle<F>` mapped type:

```ts
/**
 * Maps a single field type to its runtime JS value.
 *  - Numeric tokens → number
 *  - Nested StructDef<G> → Handle<G>
 */
type FieldValue<T> =
  T extends NumericType ? number :
  T extends StructDef<infer G> ? Handle<G> :
  never

/**
 * Public structural type of a struct handle.
 *
 * Every field in F becomes a writable accessor of the appropriate JS type.
 * `slot` is the read-only slot index the handle currently points to
 * (for nested handles it is always 0 and has no meaning — do not rely on it).
 */
export type Handle<F extends StructFields> =
  { readonly slot: number }
  & { -readonly [K in keyof F]: FieldValue<F[K]> }
```

Rules:
- `_Handle` / `_offsets` stay `?` — do NOT un-optionalize them in this task.
- `FieldType` remains exported so internal modules that import it keep compiling.
- Do not remove `NUMERIC_SIZES`.

### 2. `src/struct/struct.ts` — `const` type parameter

Change the signature to use `const F` so literal tokens are inferred narrowly:

```ts
export function struct<const F extends StructFields>(fields: F): StructDef<F>
```

No other change to `struct()` body. The cast chain that already exists inside the function stays.

### 3. `src/slab/slab.ts` — re-export `Handle<F>` from shared location

Remove the local definition:
```ts
export type Handle<F extends StructFields> = InstanceType<
  NonNullable<StructDef<F>['_Handle']>
>
```

Replace with a type re-export at the top of the file:
```ts
import type { StructDef, StructFields, Handle } from '../types.js'
export type { Handle }
```

The rest of `slab.ts` — including the `as any` and `as Handle<F>` casts around the generated class — stays byte-identical. `slab()`'s generic signature stays as-is (`<F extends StructFields>` — no need to add `const F` here, inference flows from the passed `def`).

### 4. `src/index.ts` — verify `Handle` re-export still works

`src/index.ts` currently re-exports `Handle` from `src/slab/slab.js`. Since `slab.ts` now re-exports `Handle` from `types.ts`, the chain still lands at the mapped type. Verify this compiles and that `import { type Handle } from 'rigidjs'` resolves to the mapped type in a downstream test.

No edit to `src/index.ts` should be required. If TypeScript's re-export chain causes trouble, fall back to directly re-exporting from `types.js` in `src/index.ts`.

### 5. `examples/particles.ts` — delete shadow interfaces and casts

- Delete `interface Vec3Handle` and `interface ParticleHandle`.
- Delete every `as unknown as ParticleHandle` cast (4 occurrences at time of writing).
- `const h = particles.insert()` and `const h = particles.get(i)` should compile and field access `h.pos.x`, `h.vel.y`, `h.life`, `h.id` should be typed as `number` end-to-end — zero casts required.
- Update the JSDoc comment block at the top of the file to remove the "Cast to ParticleHandle" language. Replace with a short note that field access is directly typed thanks to `struct()`'s generic inference.
- Do not introduce new runtime logic. The simulation must still print the same deterministic output: `capacity: 1024`, `len (after removal): 252`, `alive count (manual): 252`, `sum pos.x (alive): 616.928645`.

### 6. `tests/public-api/milestone-2.test.ts` — append typed-access assertion

Append a small describe block that acts as a compile-time canary. No new file, no new folder.

Proposed additions (adapt as needed):

```ts
describe('public-api — Handle<F> is fully typed', () => {
  it('field access on insert() handle is typed as number without casts', () => {
    const S = struct({
      pos: struct({ x: 'f64', y: 'f64' }),
      life: 'f32',
      id: 'u32',
    })
    const s = slab(S, 4)
    const h = s.insert()

    // These lines must compile WITHOUT any cast.
    h.pos.x = 1.5
    h.pos.y = 2.5
    h.life = 0.75
    h.id = 42

    expect(h.pos.x).toBe(1.5)
    expect(h.life).toBeCloseTo(0.75, 5)
    expect(h.id).toBe(42)

    // slot is readonly — the next line must be a type error.
    // @ts-expect-error slot is readonly
    h.slot = 99

    s.drop()
  })
})
```

Keep it small. One describe, one or two tests. No new imports beyond what the file already uses.

## Acceptance Criteria

- [ ] `bun test` exits 0 with every prior test still green plus the new typed-access test
- [ ] `bun run typecheck` exits 0
- [ ] `bun run examples/particles.ts` prints the exact same four-line summary as before task-6 (`252` alive, `616.928645` sum pos.x)
- [ ] `grep -n "as unknown" examples/particles.ts` — zero matches
- [ ] `grep -n "as any" examples/particles.ts` — zero matches
- [ ] `grep -n "ParticleHandle\|Vec3Handle" examples/particles.ts` — zero matches
- [ ] `grep -n "as unknown\|as any" src/index.ts` — zero matches
- [ ] `src/types.ts` exports a `Handle<F>` type that resolves to a mapped type with `readonly slot: number` and writable struct fields
- [ ] `tests/public-api/milestone-2.test.ts` contains at least one `// @ts-expect-error` verifying `h.slot` is readonly, and at least one test that assigns to `h.pos.x` / `h.life` / `h.id` without any cast
- [ ] Runtime unchanged: no new lines inside `insert` / `get` / `has` / `remove` method bodies, no new allocations, no new object creation
- [ ] `grep -rn "Proxy" src/` — still zero matches
- [ ] `grep -n "new ArrayBuffer(" src/slab/slab.ts` — still exactly one match
- [ ] `grep -n "new DataView(" src/slab/slab.ts` — still exactly one match

## Out of Scope (Explicit)

- Removing `?` from `_Handle` / `_offsets`
- Touching the `as any` / `as Handle<F>` casts in `src/slab/slab.ts`
- Mass-editing `as any` / `as unknown` in existing test files
- Creating `tests/types/` or any new test folder
- Adding `expectType<>` helpers, `tsd`, or new dev dependencies
- Changing `Slab<F>` interface
- Changing `struct()` behavior or `computeLayout` / `generateHandleClass` internals
- Benchmarks, lint, CI

## Notes

- **Why `const F` on `struct()`:** without it, TypeScript widens `'f64'` to `string` when it flows through the generic, and `FieldValue<'f64'>` cannot specialize. `const F` (TS 5.0+) forces literal preservation. We are on TS 5.
- **Why recursive interface for `StructFields`:** type aliases can't recurse through themselves on both sides; interface indexers can. The existing `StructDef<any>` in `FieldType` was the source of the inference collapse.
- **Why `slot` stays on nested handles:** runtime always emits a `slot` getter. Trying to strip it at the type level would require a separate `RootHandle<F>` / `SubHandle<F>` split. Out of scope and unnecessary — documentation suffices.
- **Why we don't touch internal casts:** the rule is public-boundary purity, not internal purity. `slab.ts:120`'s `new (def._Handle as any)(_view, 0, 0) as Handle<F>` is a private bridge between a runtime-generated class and the structural type. It's allowed.
- **If `src/index.ts` re-export chain breaks:** TypeScript sometimes has issues with `export type { X }` chains. If `Handle` resolves to `object` or `any` downstream, fall back to `export type { Handle } from './types.js'` in `src/index.ts` directly. Otherwise leave `src/index.ts` untouched.
- **Bun/TS version:** no version bump needed. `const F` and `infer G extends Constraint` are both TS 5.x features and we're already on TS 5.

## Verification Commands

```bash
bun test
bun run typecheck
bun run examples/particles.ts
grep -n "as unknown\|as any" examples/particles.ts
grep -n "ParticleHandle\|Vec3Handle" examples/particles.ts
grep -rn "Proxy" src/
grep -n "new ArrayBuffer(" src/slab/slab.ts
grep -n "new DataView(" src/slab/slab.ts
```

Every expected result is listed in the Acceptance Criteria above.
