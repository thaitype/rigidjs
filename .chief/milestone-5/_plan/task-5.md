# Task 5: Gap Analysis + Roadmap

## Objective

Produce a gap analysis report covering every RigidJS operation that is still below 1x JS throughput. For each gap: document root cause, path to >= 1x, and estimated difficulty. Produce a concrete roadmap for future milestones to achieve the end goal for both Direction A (predictable, GC-free large collections) and Direction B (fast columnar processing).

## Scope

**Included:**
- Gap analysis covering all benchmark scenarios from the task-4 full suite run.
- For each operation below 1x JS: root cause analysis, what architectural or algorithmic change would close the gap, estimated difficulty (easy/medium/hard/fundamental-limit), and whether it requires a handle redesign.
- Assessment of forEach impact vs for..of vs indexed get vs column access.
- Roadmap for milestone-6+ covering: what features to ship, what optimizations to pursue, what to accept as fundamental limits.
- Recommendations for which operations to prioritize for >= 1x vs which to document as "use column API instead."

**Excluded:**
- No code changes.
- No new benchmarks.

## Rules & Contracts to Follow

- `.chief/milestone-5/_goal/goal.md` -- gap analysis and roadmap are definition-of-done items.
- `.chief/_rules/_goal/rigidjs-design-spec-v3.md` -- roadmap must align with the phased delivery plan.

## Steps

1. Read the task-4 results.json and extract all scenario ratios.
2. For each scenario below 1x JS, analyze:
   - What is the dominant cost (from task-3 profiling findings)?
   - Is the root cause: (a) iterator protocol overhead, (b) handle rebase cost, (c) allocation during operation, (d) bitmap/free-list overhead, (e) buffer reallocation, (f) fundamental JS engine advantage for plain objects?
   - What change would close the gap? Is it within the current architecture or requires redesign?
   - Difficulty estimate.
3. For operations already above 1x JS (column, indexed get, forEach), document what maintains the advantage and what could cause regression.
4. Write the gap analysis report.
5. Write the roadmap with concrete milestone scopes for milestone-6+.

## Acceptance Criteria

- [ ] Gap analysis written to `.chief/milestone-5/_report/task-5/gap-analysis.md`.
- [ ] Every operation below 1x JS is covered with root cause, path, and difficulty.
- [ ] Roadmap written to `.chief/milestone-5/_report/task-5/roadmap.md`.
- [ ] Roadmap covers both Direction A and Direction B.
- [ ] Roadmap aligns with design spec phased delivery.

## Verification

No code changes -- review only.

## Deliverables

- `.chief/milestone-5/_report/task-5/gap-analysis.md`
- `.chief/milestone-5/_report/task-5/roadmap.md`
