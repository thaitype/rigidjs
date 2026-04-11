# Task 1 — Project Skeleton and `bun:test` Sanity Wiring

## Objective
Remove the `greet()` stub, establish the `src/struct/` and `tests/struct/` directory shape required by `_rules/_standard/layout.md`, and prove the `bun:test` + `bun run typecheck` toolchain works end-to-end with a trivial sanity test. No `struct()` logic yet.

## Inputs (read before starting)
- `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
- Current `/Users/thada/gits/thaitype/rigidjs/src/index.ts` (stub to be removed)
- `/Users/thada/gits/thaitype/rigidjs/package.json` and `tsconfig.json` (to confirm `bun test` / `bun run typecheck` already work)

## Deliverables
- `/Users/thada/gits/thaitype/rigidjs/src/index.ts` — emptied to a placeholder that contains a single comment explaining it is the public re-export entry and that real exports land in task 5. Must still typecheck (empty module is allowed).
- `/Users/thada/gits/thaitype/rigidjs/src/struct/.gitkeep` — placeholder so the directory exists (or any zero-byte file; do not create source files yet).
- `/Users/thada/gits/thaitype/rigidjs/tests/struct/sanity.test.ts` — one `bun:test` file with a single passing assertion (e.g., `expect(1 + 1).toBe(2)`). Imports `{ test, expect } from 'bun:test'`.
- `/Users/thada/gits/thaitype/rigidjs/package.json` — only touch if `typecheck` script is missing; otherwise leave untouched. Do NOT add runtime dependencies.

## Acceptance criteria
- [ ] `src/index.ts` no longer contains `greet` — verify with `grep -n greet src/index.ts` returning nothing
- [ ] `src/struct/` directory exists
- [ ] `tests/struct/sanity.test.ts` exists and contains a single `test(...)` call using `bun:test`
- [ ] `bun test` exits 0 and reports at least 1 passing test
- [ ] `bun run typecheck` exits 0 with zero errors
- [ ] No new runtime dependencies added to `package.json`
- [ ] `src/index.ts` contains no runtime logic (comment-only or empty module)

## Out of scope
- Any `struct()` implementation, types, or layout logic
- Any handle codegen
- Re-exports of real API symbols (deferred to task 5)
- Lint/format tooling
- CI configuration

## Notes
- This task exists to make sure the test harness is green before we add real logic, so task-2 failures are unambiguous.
- Do NOT put the sanity test under `tests/sanity.test.ts` at the repo root — it must mirror `src/struct/` per `_standard/layout.md`. After task-2 lands, this sanity file can be deleted or kept; leave it for now.
- ESM only. No default exports.
