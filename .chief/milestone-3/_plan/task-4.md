# Task 4 — B3-Column Benchmark Scenario + Final Milestone-3 Gate Check

## Objective

Ship the "receipts" scenario for the milestone-3 SoA rewrite: a new `benchmark/scenarios/b3-column.ts` that iterates a slab using `slab.column('pos.x')` and `slab.column('vel.x')` directly (no handle) against the existing B3 plain-JS baseline. Run the full benchmark suite (B1 / B2 / B3 / B7 / B8 / B9 plus the new B3-column), write the structured milestone-3 benchmark report to `.chief/milestone-3/_report/task-4/{results.json, benchmark.md}` in the same style as task-10, and write `.chief/milestone-3/_report/milestone-3-summary.md` as the canonical milestone wrap. Verify every hard-floor gate from `.chief/milestone-3/_goal/goal.md` and document aspirational target outcomes honestly — whether hit, missed, or in-between.

This task is **benchmark-only + report-only**. Zero edits to `src/**`, `tests/**`, `examples/**`.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_goal/goal.md` — authoritative for all hard floors and aspirational targets
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_contract/public-api.md`
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_plan/task-1.md` — JIT counter fix context
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_plan/task-2.md` — layout + codegen design
9. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_plan/task-3.md` — slab cutover
10. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_report/task-2/notes.md`
11. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_report/task-3/results.json` — raw numbers from the post-cutover bench run
12. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_report/task-3/notes.md`
13. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-10/benchmark.md` — format reference for the report narrative and the **What This Means For You** section (post-task-1 corrected version)
14. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/milestone-2-summary.md` — style reference for the milestone wrap
15. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-10.md` — full format reference for the **What This Means For You** section tone rules
16. Existing benchmark source, especially `benchmark/scenarios/b3-iterate-mutate.ts` (the baseline this new scenario is anchored to)

## Scope Guardrails

- **Benchmark + report surface area only.** New file `benchmark/scenarios/b3-column.ts`. New output files under `.chief/milestone-3/_report/task-4/`. The milestone summary at `.chief/milestone-3/_report/milestone-3-summary.md`. One edit to `benchmark/run.ts` to include the new scenario in the run loop. One edit to `benchmark/scenarios/*` index file (if there is one) to re-export the new scenario. Nothing else.
- **No edits to `src/**`, `tests/**`, `examples/**`, `package.json`, `tsconfig.json`, `CLAUDE.md`, `.chief/_rules/**`, or any `_contract/**` / `_goal/**` file.** If the fix appears to require any of these, stop and escalate.
- **No edits to milestone-1 or milestone-2 files.** Including the task-10 reports that task-1 overwrote. They are frozen as of end-of-task-1.
- **No edits to `src/**`.** The SoA rewrite is complete as of task-3. Task-4 only measures.
- **No new dependencies.**
- **No `/tmp` scripts. Ever.** Any probe, diagnostic, or visualization tool lives under `benchmark/` as a committed, typechecked file.
- **Benchmark code uses only public API.** `benchmark/scenarios/b3-column.ts` imports from `'../../src/index.js'` only — no deep imports into `src/struct/**` or `src/slab/**`. It exercises `slab.column('pos.x')` / `slab.column('vel.x')` through the public surface only.
- **TypeScript strict mode applies.** Zero `any` in exported signatures.
- **The existing B1 / B2 / B3 / B7 / B8 / B9 scenario behaviour is byte-identical.** Task-4 adds a sibling scenario file — it does not mutate any existing scenario. The existing B3 scenario (handle-based iterate+mutate) stays exactly as it is; it is the "mid-tier access cost" datapoint. B3-column is the "fastest-tier access cost" datapoint. Together they show the tradeoff.
- **Task-1's corrected JIT counter data under `.chief/milestone-2/_report/task-10/**` stays byte-identical.** The task-4 bench run writes to milestone-3's own directory. If `benchmark/run.ts` still writes to task-10's directory by default, task-4 must either (a) route output to `.chief/milestone-3/_report/task-4/` via a new output-path parameter added to `benchmark/run.ts`, or (b) run the bench, copy the task-4 output, then revert any files accidentally written under milestone-2's tree. The cleanest approach is (a) — add a new optional `outputDir` arg to whatever main function `benchmark/run.ts` exports, defaulting to the milestone-2/task-10 path for backwards compatibility, and invoke with the milestone-3 path for this task.

## Deliverables

### 1. `benchmark/scenarios/b3-column.ts` — new scenario file

Create `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b3-column.ts`.

The scenario must follow the existing `Scenario` / `SustainedScenario` patterns used by the other B-files. The exact interface to match is `benchmark/scenarios/b3-iterate-mutate.ts` — read it first and mirror its shape exactly.

Structure:

```ts
import { struct, slab } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// Use the SAME Particle struct and the SAME particle count as b3-iterate-mutate.ts.
// The apples-to-apples comparison relies on workload parity.

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })

const N = /* same N as b3-iterate-mutate.ts */

export const b3ColumnRigidJs: Scenario = {
  name: 'B3-column iterate+mutate (RigidJS column API)',
  setup() {
    // Build a fresh slab, fill it to N, keep a handle to it for the timing loop.
    // Pre-resolve the column TypedArray references ONCE here so the hot loop
    // is a pure TypedArray indexed-access loop with zero method calls.
  },
  fn() {
    // The hot loop. Equivalent workload to b3-iterate-mutate.ts: for each slot,
    // pos.x += vel.x, pos.y += vel.y, pos.z += vel.z (or whatever the existing
    // b3 scenario does — mirror its body exactly, just using column TypedArrays
    // instead of handle accessors).
  },
  teardown() {
    // Drop the slab.
  },
}

// No `allocate()` phase — B3-column is a throughput measurement, not an
// allocation-pressure measurement. B1 / B7 still own the allocation signal.

export const b3ColumnScenarios: readonly Scenario[] = [b3ColumnRigidJs]
```

Critical rules for the scenario:

1. **Column refs resolved in `setup()`, NOT in `fn()`.** The purpose of this benchmark is to measure pure TypedArray indexed-access throughput. Calling `slab.column('pos.x')` inside the timing loop would measure the Map lookup cost, which is irrelevant — users call `column()` once at the top of their loop. Resolve the TypedArray refs in `setup()` and store them in module-scoped `let` variables (not inside a closure — see existing scenarios for the pattern). The timing loop reads directly from those refs.
2. **The same slab instance is used across all iterations of `fn()`.** Same as B3's existing pattern. The scenario does not rebuild the slab between iterations — that would measure slab construction, not iteration throughput.
3. **Workload parity with B3.** Whatever arithmetic B3's existing handle-based scenario performs, B3-column performs the same arithmetic. Do not change the math. Do not change N. Do not change the warmup count.
4. **No `allocate()` method.** This scenario measures throughput, not allocation pressure. Leave the allocation-pressure delta null.
5. **No `Scenario` shape changes.** The harness interface stays unchanged. B3-column is just another scenario value.
6. **Baseline comparison.** The B3 plain-JS baseline scenario (from `b3-iterate-mutate.ts`) is the apples-to-apples comparison. The report cites the existing JS baseline's ops/sec as the denominator for the B3-column ratio — no new JS baseline is added. The comparison table in the report has two new rows next to the existing B3 rows:

   | Scenario | JS ops/s | RigidJS ops/s | Ratio |
   |---|---:|---:|---:|
   | B3 iter+mutate (handle) | ... | ... | ... |
   | B3-column iter+mutate (column API) | SAME as above | ... | ... |

The JS baseline column is repeated intentionally — B3-column's denominator is the existing B3 JS baseline. If the ratio is ≥ 1.0, SoA was worth it even for the handle-access tier. If the ratio is 2.0+, the column API is a clear win for power users.

### 2. `benchmark/run.ts` — include the new scenario + milestone-3 output path

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`:

1. Import `b3ColumnScenarios` from the new file.
2. Add it to the one-shot scenario run loop alongside B1 / B2 / B3 / B7.
3. Extend the output routing so that the milestone-3 report is written to `.chief/milestone-3/_report/task-4/{results.json, benchmark.md}` in addition to (or instead of, for this run) the existing task-10 output path.

The preferred approach for output routing:

- Add a second write flow at the end of `runAll()` that writes to `.chief/milestone-3/_report/task-4/results.json` and `.chief/milestone-3/_report/task-4/benchmark.md`.
- Leave the existing milestone-2 write flows (task-7 / task-9 / task-10) in place structurally, BUT guard them so they do not overwrite the existing milestone-2 files. The simplest guard: if the target file already exists, skip the write. Alternative: introduce an environment variable `BENCH_MILESTONE=3` that the task-4 run sets; when set, the milestone-2 writes are skipped and only the milestone-3 writes fire.
- Document the routing choice in a one-line comment in `run.ts`.

After the run, `git diff .chief/milestone-2/` must be empty. If it isn't, the builder must revert any accidental overwrites.

The task-10 correction block added in task-1 stays in place. Task-4's new report cites and links to task-10 for context.

### 3. `.chief/milestone-3/_report/task-4/results.json` — full raw dataset

Write the raw results of the bench run to `.chief/milestone-3/_report/task-4/results.json`. Shape mirrors task-10's `results.json`:

```json
{
  "meta": {
    "bunVersion": "...",
    "platform": "...",
    "arch": "...",
    "date": "ISO8601",
    "milestone": "milestone-3",
    "task": "task-4",
    "jitCountersAvailable": ["numberOfDFGCompiles", "totalCompileTime", /* ... */],
    "baselineReference": ".chief/milestone-2/_report/task-10/results.json"
  },
  "oneShot": [ BenchResult, ... ],
  "sustained": {
    "b8": [ SustainedResult, ... ],
    "b9": [ SustainedResult, ... ]
  },
  "b3Column": [ BenchResult, ... ]
}
```

The `b3Column` key is a separate top-level array because it is a milestone-3-specific addition — consumers of prior raw data JSON files (if any) keep working because they don't know to look for it.

### 4. `.chief/milestone-3/_report/task-4/benchmark.md` — structured report

Write the structured milestone-3 benchmark report at `.chief/milestone-3/_report/task-4/benchmark.md`. Match the task-10 report format section by section. Required structure:

#### Front matter
- Bun version, platform/arch, date
- `jitCountersAvailable` list
- Link to task-10's benchmark.md as the direct predecessor
- Link to `.chief/milestone-2/_report/milestone-2-summary.md` for milestone-2 context

#### Introduction (3–5 sentences)
- Milestone-2 shipped slab() and proved the GC-pressure win (~300x fewer objects) and tail-latency win (3x max-tick at 100k) but left mean throughput at 0.16–0.38x plain JS.
- Milestone-3 rewrote the struct layout and handle codegen from AoS + DataView to SoA + monomorphic TypedArray, added `slab.column()`, fixed the task-10 JIT counter bug, and re-ran the full suite.
- This report presents the re-run data, the new B3-column receipts scenario, and the gate-check verdict.

#### What This Means For You (End-User Impact) — MANDATORY
This section comes immediately after Introduction and before the technical tables. It is the most important section of the report. Tone rules from task-10 apply (plain language, absolute numbers preferred over ratios, cite specific benchmarks, honest about losses). Required subsections:

- **### Memory you'll actually use** — compare RigidJS vs JS settled and high-water RSS for B8 and the largest B9 capacity. Has the ~300x fewer GC-object win survived the SoA rewrite? State the answer in plain terms. Cite specific numbers from task-4's results.json.
- **### CPU cost — has the SoA rewrite closed the throughput gap?** — present B1 / B2 / B3 / B7 mean throughput ratios honestly. If the SoA rewrite closed the gap to 0.70x+, say so. If it only closed to 0.50x, say so. If the new B3-column scenario ships a 1.0x+ ratio, highlight that — it is the proof that SoA + monomorphic codegen was worth it.
- **### Tail latency — is the milestone-2 win still intact?** — compare B8 max-tick RigidJS vs JS. Cite the hard-floor gate (≤1ms). State whether the gate passed.
- **### When should I use the handle API vs the column API?** — decision guide framed in plain language. "Use handles (`slab.get(i).pos.x`) when your code reads for clarity or uses nested field paths naturally. Use columns (`slab.column('pos.x')`) when you have a tight inner loop mutating one or two fields across every slot and throughput matters more than clarity. The benchmark numbers: B3 handle-based iterate+mutate is X ops/sec, B3-column is Y ops/sec — the column API gives Z× the throughput of the handle API at the cost of explicit column wiring."
- **### When should I use RigidJS vs plain JS?** — updated decision guide based on milestone-3 numbers. Follow task-10's template but refresh the recommendation with the new ratios. Honest about where plain JS still wins.

#### Technical results
- One-shot scenarios table (B1 / B2 / B3 / B7 / B3-column) — ops/sec, allocation delta, retained, heap MB, RSS MB, CPU total ms, `dfgΔ`, high-water RSS, `totalCompileMs`. Same columns as task-10's table. Add one row for B3-column.
- Sustained scenarios table (B8 / B9) — ticks, mean / p50 / p99 / p999 / max tick, `dfgΔ`, high-water RSS, `totalCompileMs`.
- B8 heap time-series sparklines (if task-10's collection path still works — it should, since the harness was not functionally changed).
- Comparison-to-task-10 table: for each scenario that existed in task-10, show (task-10 value, task-4 value, delta). This is the "did milestone-3 regress or improve each metric" table.

#### Gate-check verdict
A checkbox list replaying every hard-floor criterion from `.chief/milestone-3/_goal/goal.md` and stating whether it passed with the specific number. Example:

```
- [x] All 155+ behavioural tests pass. Actual: 172 tests.
- [x] `bun test` exits 0.
- [x] `bun run typecheck` exits 0.
- [x] B8 max-tick ≤ 1ms. Actual: 0.43ms. Pass.
- [x] B1 RigidJS allocated ≤ 1000 live GC objects. Actual: 327. Pass.
- [x] B7 RigidJS allocated ≤ 1000 live GC objects. Actual: 502. Pass.
- [x] Zero public API removals. Verified by contract cross-check.
- [x] slab.buffer still returns a single ArrayBuffer. Verified.
- [x] No /tmp scripts. Verified.
- [x] Task-1 JIT counter fix produces real non-zero dfgΔ. Actual: 1 on B3 RigidJS.
- [x] B3 iterate+mutate RigidJS shows dfgΔ ≤ 3 (monomorphic codegen). Actual: 1.
```

If any hard-floor criterion fails, **mark it as failed, say so explicitly, and stop** — do not write a "pass" narrative on top of failed gates. Escalate to chief-agent. The milestone is not complete until every hard floor passes.

#### Aspirational target outcomes
Another checkbox list for the aspirational targets, showing where the numbers actually landed. Honest reporting — if B3 iter+mutate stayed at 0.45x instead of the 0.70x aspiration, report 0.45x and explain in a sentence.

#### Honest limits (inherited from milestone-2)
- Single machine, single run, Apple M-series, Bun 1.3.x — no statistical significance claims.
- B4 / B5 / B6 still not runnable (require `.iter()`, `bump`, `vec()`). Re-run after those land.
- `numberOfDFGCompiles(wrapper)` blind spot: does not capture nested-function recompiles. `totalCompileTime()` delta is the process-global catch-all.

#### Next open questions
- Does the SoA rewrite close the mean-throughput gap fully at 1M+ capacity? B9 data shows the curve.
- Does `.iter()` from future milestones further amortize access cost?
- Do the numbers hold on non-Apple-Silicon hardware?

### 5. `.chief/milestone-3/_report/milestone-3-summary.md` — canonical milestone wrap

Write the milestone-3 canonical summary in the same style as `.chief/milestone-2/_report/milestone-2-summary.md`. Required sections:

- **What shipped** — bullet list: SoA + TypedArray codegen, `slab.column()` additive API, `ColumnKey<F>` / `ColumnType<F, K>` type helpers, B3-column benchmark scenario, task-1 JIT counter fix, full re-run of B1–B9 plus B3-column.
- **The story (task-1 → task-2 → task-3 → task-4)** — one paragraph per task, tracing the logical arc: fix the measurement, rewrite the infrastructure, cut over the slab, re-run and publish. Follow the tone of milestone-2-summary's "benchmark journey" section.
- **Hard floors — all green** (or list any failures).
- **Aspirational targets — actual outcomes**, reported honestly.
- **Before / after table** — one small comparison matrix: B1, B2, B3, B7 mean throughput ratios from milestone-2 vs milestone-3, plus the new B3-column row. This is the one-screen answer to "did the rewrite work".
- **Honest limits** — inherited from milestone-2 + any new limits surfaced by milestone-3.
- **Open questions for milestone-4+** — what's left.
- **Deliverables landed** — list of files touched across milestone-3.
- **Status** — milestone-3 complete; ready for milestone-4.

Target length: ~100–150 lines of markdown. Concise, honest, useful for a new reader catching up on the project.

## Probe-Verify Step

Before writing the benchmark report, verify:

1. **B3-column ratio is sane.** Open `results.json`, find the B3-column RigidJS scenario, compute `opsPerSec(b3Column) / opsPerSec(b3JsBaseline)`. If the ratio is <0.5 the scenario is wrong (column API should be strictly faster than handle iteration, because handles add method-call overhead on top of the underlying TypedArray access). Diagnose before proceeding — usually this means column refs were resolved inside the timing loop instead of in `setup()`.
2. **Gate-check pre-flight.** Before writing the report, manually run through the hard-floor gates against the raw data:
   - B8 max-tick from `sustained.b8[rigidjs].maxTickMs`
   - B1 allocation delta from `oneShot[b1Rigid].allocationDelta`
   - B7 allocation delta from `oneShot[b7Rigid].allocationDelta`
   - `bun test` and `bun run typecheck` pass
   - `bun run examples/particles.ts` diff against expected deterministic output
   - `dfgCompilesDelta` on B3 RigidJS
   If any fails, STOP. The milestone is not complete — escalate to chief-agent. Do not write a pass narrative on top of failed gates.
3. **Contract cross-check.** Grep `src/index.ts` for every symbol listed in `.chief/milestone-2/_contract/public-api.md`. Every milestone-2 symbol must still be exported. `column()` must appear on the `Slab<F>` interface. `ColumnKey` and `ColumnType` must be re-exported as type-only exports.
4. **`git diff .chief/milestone-2/` is empty.** No milestone-2 file was accidentally overwritten by the bench run.

## Acceptance Criteria

- [ ] `bun test` exits 0 with zero failing tests.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run examples/particles.ts` produces identical deterministic output to milestone-2 (byte-for-byte).
- [ ] `benchmark/scenarios/b3-column.ts` exists, imports only from `'../../src/index.js'`, and exercises `slab.column('pos.x')` / `slab.column('vel.x')` in the timing loop with column refs resolved once in `setup()`.
- [ ] `bun run bench` runs to completion with the new scenario in the suite.
- [ ] `.chief/milestone-3/_report/task-4/results.json` exists with the full dataset (oneShot + sustained + b3Column).
- [ ] `.chief/milestone-3/_report/task-4/benchmark.md` exists with the required sections (Introduction → What This Means For You → Technical results → Gate-check verdict → Aspirational targets → Honest limits → Next open questions).
- [ ] The **What This Means For You** section covers all five required subsections with plain-language framing, cites specific benchmarks, and honestly reports any losses.
- [ ] Every hard-floor gate from `.chief/milestone-3/_goal/goal.md` is replayed in the Gate-check verdict section with an explicit pass/fail and the specific number.
- [ ] `.chief/milestone-3/_report/milestone-3-summary.md` exists and follows the structure of `milestone-2-summary.md`.
- [ ] `git diff .chief/milestone-2/` is empty. Every milestone-2 file byte-identical.
- [ ] `git diff src/` is empty.
- [ ] `git diff tests/` is empty.
- [ ] `git diff examples/` is empty.
- [ ] `package.json` byte-identical.
- [ ] Zero `/tmp` scripts created.
- [ ] If any hard floor fails, the report states so explicitly, the milestone status is NOT "complete", and the task escalates to chief-agent. No silent passes.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-3/_plan/_todo.md`** — the chief-agent owns that checklist.

## Out of Scope

- Any `src/**` edit. Source code is frozen as of task-3.
- Adding new benchmark scenarios beyond B3-column. Future milestones.
- Rewriting milestone-2 summaries or task-10 narrative beyond what task-1 already did.
- Statistical significance analysis — single-run, single-machine data continues to be the reporting model.
- New allocation-pressure scenarios. The existing B1 / B7 `allocate()` phases continue to own that signal.
- Benchmark harness restructuring. Leave `BenchResult` / `SustainedResult` shape as-is.

## Notes

- The `benchmark.md` report is long. Budget appropriate time for the **What This Means For You** section — task-10's implementation of that section is the format bar. Plain language, absolute numbers, honest, cite sources. Do not skip the "when should I use plain JS" honesty.
- The `column()` API is additive — users who don't know about it still get the milestone-3 throughput improvements via the handle API because the handle accessors now use monomorphic TypedArray indexed access. The column API is strictly for power users who want to drop the handle call overhead for the fastest possible inner loop.
- Task-4 is the first task in milestone-3 to produce a public-facing narrative. Keep the tone consistent with task-10: engineering honest, no marketing language, every claim cited to a specific number.
- If the task-3 gut-reaction bench numbers in `.chief/milestone-3/_report/task-3/notes.md` already indicate a hard-floor gate failure, surface that in the task-4 report and stop. The report exists to document the reality, not to argue with it.
- The ~300x GC-pressure win from task-8 is the most important milestone-2 result. Milestone-3 must NOT regress it past the ≤1000 live-object hard floor. If the SoA rewrite accidentally doubles the count (e.g. from 315 to 600), that is still within the hard floor but worth noting in the report as "SoA adds one TypedArray sub-view per column — for a 2-field struct that's ~2 extra objects, for an 8-field struct ~8 extra objects. At the 100k-item scale this is rounding error."
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes. Plus every hard-floor gate in `.chief/milestone-3/_goal/goal.md` passes.
