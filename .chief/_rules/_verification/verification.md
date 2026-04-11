# Verification Rules

Global definition of done. A task is not complete until all required checks pass.

## Required Checks

| Check      | Command             | Owner         | Required |
|------------|---------------------|---------------|----------|
| Unit tests | `bun test`          | builder-agent | ✅       |
| Typecheck  | `bun run typecheck` | builder-agent | ✅       |

`bun run typecheck` runs `tsc --noEmit` using the repo's `tsconfig.json` (strict mode).

## Definition of Done (per task)

A task is DONE when **all** of the following are true:

1. `bun test` exits 0 with zero failing tests
2. `bun run typecheck` exits 0 with zero errors
3. Every public API symbol added or changed has at least one correctness test in `tests/`
4. No new runtime dependencies added to `package.json` (see `_standard/`)
5. No symbols in `_rules/_contract/` or the current milestone's `_contract/` were renamed or removed
6. The task's acceptance criteria in `.chief/milestone-X/_plan/task-N.md` are all checked off

## Out of Scope for Verification (Phase 1a)

- Benchmark regression gates — deferred; benchmark harness arrives with containers (slab/vec/bump)
- Lint/format — not configured yet; add only when the team agrees on a tool
- Integration/UI tests — not applicable to a pure library

## Failure Handling

- Builder-agent must fix type/test/build failures autonomously before reporting task complete
- If a failure reveals a contract ambiguity, stop and escalate to chief-agent — do NOT silently change the contract
- Never skip checks with `-- --bail`, `.skip`, `.only`, or by deleting tests to make CI pass
