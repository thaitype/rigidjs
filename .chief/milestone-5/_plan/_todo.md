# TODO List for Milestone 5 -- Predictable, GC-Free Large Collections

Tasks run strictly in order. Each task has a hard prerequisite on the one before it.

## Batch 1 (current)

- [x] task-1: Per-process benchmark isolation -- rewrite benchmark/run.ts to spawn each scenario in a separate Bun.spawn() subprocess. Simplified CLI: `bun run bench` (all) or `bun run bench -s B1-slab` (single). Sequential execution, no parallel spawning.
- [x] task-1.5: Split JS baseline and RigidJS into separate processes -- restructure scenario files so each variant runs in its own subprocess. JS runs first, then RigidJS. Complete JIT isolation between variants.
- [x] task-2: forEach(cb) for vec and slab + vec.reserve(n) -- add vec.forEach(cb, thisArg?), slab.forEach(cb, thisArg?), and vec.reserve(n). Internal counted for-loop, no iterator protocol. Tests for correctness. Add B3-vec-forEach and B3-slab-forEach benchmark scenarios.
- [x] task-3: Profile throughput bottlenecks -- profile B1 (creation) and B2 (churn) for both slab and vec using Bun.nanoseconds() micro-timers. Write findings to .chief/milestone-5/_report/task-3/profiling-findings.md. Implement fixes for any bottlenecks that are feasible within the existing architecture. Re-run affected scenarios to measure impact.

## Batch 2 (after batch 1 completes)

- [x] task-4: B8-vec, B9-vec sustained benchmarks + full suite re-run -- add B8-vec (sustained churn) and B9-vec (heap scaling) scenarios. Run the complete benchmark suite with per-process isolation. Produce authoritative results.json.
- [x] task-5: Gap analysis + roadmap -- write gap analysis report covering every operation below 1x JS with root cause, path to >= 1x, and difficulty estimate. Write concrete roadmap for future milestones targeting the end goal for both Direction A and Direction B.

**Note for builder-agents:** do NOT update this file yourselves. The human / chief-agent owns the checklist. Builder-agents finish their tasks and report back; chief-agent marks the box.
