# Task 5 — Public API Wiring and Milestone-1 Final Acceptance

## Objective
Wire the public API through `src/index.ts`, enforce the empty-fields guard at the API boundary, and verify every success criterion from the milestone-1 goal file.

## Inputs (read before starting)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_contract/public-api.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-1/_contract/public-api.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-1/_goal/goal.md` (the "Success Criteria" checklist is the authoritative acceptance list)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md` (index.ts must be re-exports only)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`

## Deliverables
- `/Users/thada/gits/thaitype/rigidjs/src/index.ts` — re-exports ONLY:
  ```ts
  export { struct } from './struct/struct'
  export type { StructDef, StructFields, NumericType } from './types'
  ```
  No other exports. No logic. No default export.
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/public-api.test.ts` — imports exclusively from the package entry (`'../../src/index'` or the package name if configured) and asserts:
  - `struct({ x: 'f64', y: 'f64', z: 'f64' }).sizeof === 24`
  - Particle example has `sizeof === 56`
  - `struct({})` throws
  - Handle field access on a `struct({ v: 'f64' })` returns a `number` (type-level check via `satisfies number` on the read value)
  - `StructDef`, `StructFields`, `NumericType` are importable as types
- Delete `/Users/thada/gits/thaitype/rigidjs/tests/struct/sanity.test.ts` (from task-1) if still present — the new public-api test supersedes it.
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-1/_report/task-5/acceptance.md` — a short report file listing each milestone-1 success criterion and the evidence (test name, grep output, or command) that proves it. This is reference material for chief-agent review.

## Acceptance criteria
All items from `.chief/milestone-1/_goal/goal.md` §Success Criteria must be verified. Re-stated here for convenience:
- [ ] `bun test` passes with ≥1 test per numeric type (from task-3)
- [ ] `bun run typecheck` passes
- [ ] `struct({ x:'f64', y:'f64', z:'f64' }).sizeof === 24` (public-api.test.ts)
- [ ] Particle example has `sizeof === 56` with correct per-field offsets (task-4 test still green)
- [ ] Handle field access is typed as `number` end-to-end (public-api.test.ts and no `any` in exported signatures)
- [ ] `grep -rn "Proxy" src/` returns zero matches
- [ ] `grep -rn "new Function" src/` matches only inside `src/struct/handle-codegen.ts`
- [ ] `src/index.ts` contains only `export { ... } from '...'` and `export type { ... } from '...'` statements — verify with a simple grep
- [ ] Design spec file `.chief/_rules/_goal/rigidjs-design-spec-v3.md` has not been modified (`git status` shows no changes to it)
- [ ] No new runtime dependencies in `package.json`
- [ ] `src/internal/single-slot.ts` is NOT reachable via `import 'rigidjs'` — verify it is not re-exported from `src/index.ts`
- [ ] Empty-fields call (`struct({})`) throws a clear `Error`
- [ ] `.chief/milestone-1/_report/task-5/acceptance.md` exists and maps every success criterion to its evidence

## Out of scope
- Any new runtime features
- `slab()`, `vec()`, `bump()`, iterators, `.drop()`, string types
- Benchmark harness
- CI / lint configuration

## Notes
- `src/index.ts` uses the `export type { ... }` form for type-only re-exports per `_standard/typescript.md` (strict, ESM).
- If `bun run typecheck` surfaces any type leak (e.g., `any` in `StructDef` public shape), fix it at the source file (`src/types.ts`) — do NOT weaken the public type in `src/index.ts`.
- The task-5 acceptance report is the hand-off document to close milestone-1; write it last, after all checks pass.
- If anything in the success criteria cannot be satisfied without breaking an earlier task, STOP and escalate to chief-agent rather than silently changing the contract.
