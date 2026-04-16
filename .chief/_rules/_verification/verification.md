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

## Benchmark Verification (Soft Gates)

Benchmarks are run to detect regressions, not to block tasks. Builder-agents should **warn** if a proven win drops below 1x, but do not fail the task.

### Per-task benchmark check

When a task modifies code in `src/`, run benchmarks for **affected scenarios only**:
- Changed `src/vec/` → run `bun run bench -s B3-vec-column`, `bun run bench -s B2-vec`, and any relevant hybrid/small-scale scenarios
- Changed `src/slab/` → run `bun run bench -s B3-slab-forEach`, `bun run bench -s B2-slab`
- Changed `src/struct/` → run scenarios for both vec and slab

If any of these **proven wins** drop below 1x, warn in the task report:
- B3-vec-column (column iteration) — expected ≥2x
- B3-vec-get (indexed get at 100k) — expected ≥1x
- B3-vec-forEach (forEach at 100k) — expected ≥1x
- B2-vec (churn at 10k) — expected ≥1x
- B8-vec (sustained 10s) — expected ≥1x in ticks
- B3-slab-forEach (slab forEach) — expected ≥1x

### Final task of each milestone

Run full benchmark suite: `bun run bench`. Run small-scale with `bun run bench -s B1-hybrid -n 20` and `bun run bench -s B2-hybrid -n 20` for stable numbers.

## Milestone Deliverables

### final-progress-report.md

Every milestone must produce `.chief/milestone-X/_report/final-progress-report.md` at the end. This is the "bus stop" — a snapshot of where RigidJS stands after this milestone.

Rules:
- **Primary comparison is vs JS baseline.** "How does RigidJS compare to plain JS right now?"
- Previous milestone data is **supporting context**, not the main comparison
- Include actual benchmark numbers (median + stddev for small-N, single run for large-N)
- Be honest about variance and confidence

## Out of Scope

- Lint/format — not configured yet; add only when the team agrees on a tool
- Integration/UI tests — not applicable to a pure library

## Failure Handling

- Builder-agent must fix type/test/build failures autonomously before reporting task complete
- If a failure reveals a contract ambiguity, stop and escalate to chief-agent — do NOT silently change the contract
- Never skip checks with `-- --bail`, `.skip`, `.only`, or by deleting tests to make CI pass
