# TODO List for Milestone 3 — SoA + TypedArray Handle Codegen

Tasks run strictly in order. Each task has a hard prerequisite on the one before it.

- [x] task-1: Fix task-10 JIT counter measurement bug (prerequisite) — rewrite `benchmark/probe-jsc.ts` and `benchmark/harness.ts` to probe function-argument counters correctly, add `totalCompileTime()` delta sampling, re-run `bun run bench`, overwrite `.chief/milestone-2/_report/task-10/{results.json, benchmark.md, bun-jsc-probe.txt}` with corrected numbers. Zero `src/` edits.
- [x] task-2: Layout + codegen SoA rewrite (internal, not yet wired) — extend `src/types.ts` with `ColumnKey<F>` / `ColumnType<F, K>`; rewrite `src/struct/layout.ts` to compute single-buffer column layout with natural-alignment sort; rewrite `src/struct/handle-codegen.ts` to emit monomorphic TypedArray getters/setters. Old slab path still uses DataView. All existing tests must stay green.
- [x] task-3: Wire slab to SoA + add `column()` — rewrite `src/slab/slab.ts` to build TypedArray column sub-views into a single `ArrayBuffer`, add `slab.column(name)` public method, re-export `ColumnKey` / `ColumnType` from `src/index.ts`, delete the old AoS codegen path. Update internal tests that poked `_v` / `_o` shape. Run the benchmark suite and archive raw results to `.chief/milestone-3/_report/task-3/`.
- [x] task-4: New B3-column benchmark scenario + final gate check — add `benchmark/scenarios/b3-column.ts`, run full suite including B3-column, write `.chief/milestone-3/_report/task-4/{results.json, benchmark.md}` in task-10 style with **What This Means For You** section, write `.chief/milestone-3/_report/milestone-3-summary.md`, verify all hard floor gates pass and document aspirational target outcomes honestly.

Optional (include only if chief-agent judges it worth the effort during execution):

- [ ] task-5: Commit `benchmark/probe-typed-array-throughput.ts` as a reusable diagnostic tool that isolates TypedArray indexed-access throughput vs plain JS property access. Skip if scope creep.

**Note for builder-agents:** do NOT update this file yourselves. The human / chief-agent owns the checklist. Builder-agents finish their tasks and report back; chief-agent marks the box.
