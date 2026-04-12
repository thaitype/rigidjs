# Task 1 — Fix Task-10 JIT Counter Measurement Bug (Prerequisite)

## Objective

Fix the deferred measurement bug documented in `.chief/milestone-2/_report/milestone-2-summary.md` under "Known measurement issues (deferred fixes)": `numberOfDFGCompiles` and its sibling function-argument counters were called with zero arguments in `benchmark/probe-jsc.ts` and `benchmark/harness.ts`, producing `undefined` which was then misclassified as "counter unavailable on this Bun version". The real signature is `numberOfDFGCompiles(fn: Function): number` — passing a specific warmed-up function returns an actual compile count. Rewrite the probe and harness to call these counters correctly, add `totalCompileTime()` delta sampling as a process-global secondary signal, re-run `bun run bench`, and **overwrite** the three task-10 report artifacts (`results.json`, `benchmark.md`, `bun-jsc-probe.txt`) with corrected numbers. Task-7 and task-9 reports stay byte-identical.

This fix is a hard prerequisite for milestone-3's gate checks: the new SoA codegen (task-2 / task-3) must be verified as monomorphic via real `dfgΔ` values on B3 iterate+mutate. Without a working counter we cannot distinguish "codegen is monomorphic" from "codegen recompiled 40 times mid-run".

This task is **benchmark-only**. Zero edits to `src/**`, `tests/**`, `examples/**`.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_goal/goal.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-3/_contract/public-api.md`
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/milestone-2-summary.md` — read the "Known measurement issues (deferred fixes)" section in full; it contains the root cause, repro, correct measurement strategy, and list of all counters hit by the same bug.
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-10.md` — prior format reference, harness shape, `BenchResult` / `SustainedResult` field layout.
9. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-10/benchmark.md` — the report whose JIT data you are correcting; preserve the narrative structure and rewrite only the JIT block + the correction notice.
10. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-10/results.json` — prior raw numbers.
11. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-10/bun-jsc-probe.txt` — prior probe output, to be overwritten.
12. Existing benchmark source:
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/probe-jsc.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b1-struct-creation.ts` through `b9-heap-scaling.ts`

## Scope Guardrails

- **Benchmark-only surface area.** All edits land under `benchmark/**` plus the three overwritten files under `.chief/milestone-2/_report/task-10/`. Nothing else.
- **No edits to `src/**`, `tests/**`, `examples/**`, `package.json`, `tsconfig.json`, `CLAUDE.md`, `.chief/_rules/**`, any `_contract/**` file, any `_goal/**` file, the design spec, milestone-1 files, task-7 report, task-8 report, or task-9 report.** If the fix appears to require any of these, stop and escalate.
- **No new dependencies.** `package.json` stays byte-identical.
- **Public API only.** Benchmark files import exclusively from `'../src/index.js'` / `'../../src/index.js'`. No deep imports into `src/struct/**` or `src/slab/**`.
- **Existing B1–B9 scenario behaviour is byte-identical.** No changes to `Scenario` / `SustainedScenario` semantics, workload shape, warmup counts, iteration counts, durations, capacities, or tick bodies. The JIT counter bracket moves to call-sites inside the existing `bench()` / `benchSustained()` functions — it does NOT touch any scenario file.
- **No `/tmp` scripts. Ever.** Any utility or one-off experiment needed to validate the fix MUST live under `benchmark/` as a committed, typechecked file runnable via `bun run benchmark/<name>.ts`.
- **TypeScript strict mode applies.** Zero `any` in exported signatures. The `jsc` module is cast through `Record<string, unknown>` at the module boundary once with a single explanatory comment, same pattern as task-10.
- **Task-10 reports are the only "modify prior artefact" exception** in milestone-3. This is allowed because the existing task-10 JIT data is factually wrong — not a revision for style. Task-7 and task-9 report files remain byte-identical across the whole milestone.
- **No hidden allocations inside the measurement window.** The JIT counter calls before/after the window are exactly two reads each (one per counter); `totalCompileTime()` is one read. All allocations for delta bookkeeping happen outside the timed loop.

## Deliverables

### 1. `benchmark/probe-jsc.ts` — rewrite to probe function-argument counters correctly

Rewrite the probe to produce output that clearly distinguishes three counter categories:

1. **Zero-arg counters** (e.g. `totalCompileTime`, `heapSize`) — called with `()`, return a number directly. Existing behaviour is correct for these and the output format stays the same.
2. **Function-argument counters** (`numberOfDFGCompiles`, `numberOfFTLCompiles`, `numberOfOSRExits` if present, `reoptimizationRetryCount`, `optimizeNextInvocation`, `noFTL`, `noInline`) — signature `(fn: Function) => number`. Probe these by:
   - Defining a throwaway top-level named function `const probeHot = (x: number): number => x * x + x`.
   - Warming it past the DFG threshold: `for (let i = 0; i < 1_000_000; i++) probeHot(i)` (tune iteration count if needed — 1M is known to reliably trigger DFG on Bun 1.3.8, see milestone-2 summary repro).
   - Calling each counter **with `probeHot` as argument** and printing the returned value.
   - If the counter throws or returns `undefined`, print `<unavailable>` — that is the "really not on this Bun version" signal, and it must look different from the "we called it wrong" failure mode that produced the original bug.
3. **Special case — `totalCompileTime`.** Print the value at probe start (module-global delta from process start). The harness will sample before/after delta separately; the probe just confirms the zero-arg call works.

Probe output contract:

```
bun:jsc probe — function categories
===================================
[zero-arg]
  totalCompileTime() = <number> ms
  heapSize()         = <number> bytes
  ...
[fn-arg]
  numberOfDFGCompiles(probeHot)        = <number>
  numberOfFTLCompiles(probeHot)        = <number> | <unavailable>
  numberOfOSRExits(probeHot)           = <number> | <unavailable>
  reoptimizationRetryCount(probeHot)   = <number> | <unavailable>
  ...
[resolved-for-harness]
  jitCountersAvailable = ["numberOfDFGCompiles", ...]
```

The `[resolved-for-harness]` block lists the exact `bun:jsc` function names the harness will use at runtime. It must be consistent with what `benchmark/harness.ts` actually wires up in deliverable §2. The probe must not fail if any optional counter is absent — it reports `<unavailable>` and moves on.

Enumerate `Object.keys(jsc)` and print a sorted list at the end so future builders can see the full surface on their Bun version without re-reading the probe source.

Type rules:
- Explicit return types on exported functions (if any).
- No `any` in exported signatures. `jsc` is cast to `Record<string, unknown>` once at the top of the file with a one-line comment explaining the cast (same pattern as task-10 §1a).
- The probe is runnable via `bun run benchmark/probe-jsc.ts` and its output is piped to `.chief/milestone-2/_report/task-10/bun-jsc-probe.txt` as part of the re-run in deliverable §4.

### 2. `benchmark/harness.ts` — rewire JIT counter sampling to pass `scenario.fn` / `scenario.tick`

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`. All changes are strictly corrections to the existing JIT counter bracket introduced in task-10. No other fields, no other phases, no workload changes.

#### 2a. Correct the counter resolution

Replace the broken zero-arg counter probe with a typed pair of function references:

```ts
// Cast once, not per-call. `verbatimModuleSyntax` + strict mode compatibility.
const jscModule = jsc as unknown as Record<string, unknown>

type FnArgCounter = (fn: Function) => number

const dfgCompilesFn: FnArgCounter | null =
  typeof jscModule.numberOfDFGCompiles === 'function'
    ? (jscModule.numberOfDFGCompiles as FnArgCounter)
    : null

const ftlCompilesFn: FnArgCounter | null = /* same pattern */
const osrExitsFn:    FnArgCounter | null = /* same pattern */

// Zero-arg process-global counter.
const totalCompileTimeFn: (() => number) | null =
  typeof jscModule.totalCompileTime === 'function'
    ? (jscModule.totalCompileTime as () => number)
    : null
```

Include only counters that actually exist on Bun 1.3.x today — if `ftlCompilesFn` is null because the counter is absent, leave the reference as `null` and the harness writes `null` in the result field. Do not invent workarounds. Do not use `any`.

#### 2b. Fix the sampling sites in `bench()`

Inside `bench(scenario: Scenario)`, change the counter bracket so that `dfgBefore` / `dfgAfter` pass `scenario.fn` as the argument:

```ts
const dfgBefore = dfgCompilesFn !== null ? dfgCompilesFn(scenario.fn) : null
// ...existing warmup → timing loop → post-GC...
const dfgAfter  = dfgCompilesFn !== null ? dfgCompilesFn(scenario.fn) : null

result.dfgCompilesDelta = (dfgBefore !== null && dfgAfter !== null)
  ? dfgAfter - dfgBefore
  : null
```

Same pattern for `ftlCompilesDelta` and `osrExitsDelta`. Same bracket position (immediately before warmup, immediately after post-window GC+sleep) as task-10 — do not move the bracket.

#### 2c. Fix the sampling sites in `benchSustained()`

Same fix in `benchSustained(scenario: SustainedScenario)` — pass `scenario.tick` as the counter argument. If the sustained scenario exposes the tick function under a different field name (verify from existing source), use that field. **Do not invent or rename any field on `SustainedScenario`** — use whatever is already there.

#### 2d. Add `totalCompileTime()` delta sampling

Add a new field to both `BenchResult` and `SustainedResult`, appended to the existing task-10 additions:

```ts
export interface BenchResult {
  // ...all existing task-10 fields unchanged...
  totalCompileTimeMsDelta: number | null
}
```

Sample `totalCompileTimeFn()` at the same two bracket points as the DFG counters. Compute delta in milliseconds (the counter returns ms directly per the `bun:jsc` docs — verify in the probe and document). Write `null` if the counter is unavailable.

This is a process-global signal — it captures ALL JSC compile time across the sampling window, not just compiles of `scenario.fn`. Document that limitation in the field JSDoc: "Process-global JSC compile time delta across the measurement window. Includes compiles of any function, not just scenario.fn. Zero or very small delta means the window was JIT-stable end to end."

#### 2e. Document the blind spot

Add a one-paragraph comment block above the JIT counter section explaining:

- `numberOfDFGCompiles(scenario.fn)` measures recompiles of the **wrapper closure** only.
- It does NOT capture recompiles of nested functions called inside the wrapper — JSC tracks those separately per-function.
- `totalCompileTime()` delta is the process-global catch-all that does cover nested functions.
- The pair of signals together is the best we can do from userland without JSC internals access.

This comment is inherited from the milestone-2 summary's correct-strategy notes.

#### 2f. Update `formatTable()` / `formatSustainedTable()`

Add `totalCompileMs` column rendering (render `null` as `-`). The existing `dfgΔ` / `ftlΔ` / `osrExitsΔ` columns now show real numbers instead of all dashes — no format change is needed there, they just start carrying data. Widen the table if necessary.

### 3. `benchmark/run.ts` — no structural changes, confirm paths

Confirm that `benchmark/run.ts` still writes to `.chief/milestone-2/_report/task-10/{results.json, benchmark.md}` and that the `jitCountersAvailable` array in the meta block accurately reflects the resolved-for-harness list from §1. No restructuring, no new output directories. Task-10's directory is the write target for this fix specifically because we are correcting task-10's data; no new milestone-3 report directory is created by this task.

The existing task-7 and task-9 write flows must stay byte-identical — verify by inspection that the file paths and write logic for those flows are untouched.

### 4. Re-run the benchmark suite and overwrite task-10 reports

1. Run `bun run bench` from the repo root. Full suite: B1, B2, B3, B7, B8, B9.
2. The run writes:
   - `.chief/milestone-2/_report/task-10/results.json` (overwritten)
   - `.chief/milestone-2/_report/task-10/benchmark.md` (overwritten)
3. Pipe probe output explicitly: `bun run benchmark/probe-jsc.ts > .chief/milestone-2/_report/task-10/bun-jsc-probe.txt` (overwritten)
4. Update the **correction block** in `benchmark.md` to reflect the fixed data:
   - Remove or rewrite any prose that attributed null counters to "Bun 1.3.8 limitation".
   - Add a new short section **"Correction — JIT counter measurement fixed in milestone-3/task-1"** near the top, immediately after the front matter, explaining:
     - The original task-10 report attributed null counters to a Bun version limitation.
     - That attribution was incorrect — `numberOfDFGCompiles` takes a function argument and was being called with zero arguments.
     - This re-run uses the corrected harness and the `dfgΔ` / `ftlΔ` / `osrExitsΔ` columns now carry real numbers.
     - Cite the milestone-2 summary "Known measurement issues" section as the source of the root cause.
5. **Do NOT rewrite the task-10 narrative itself** beyond the correction notice and the now-populated JIT number columns. CPU totals, high-water RSS, heap time-series sparklines, and per-tick latency percentiles are all unaffected by the JIT counter bug and their narrative stays as-is. Task-7 and task-9 reports are untouched.
6. Preserve the front matter and meta block format — only the `jitCountersAvailable` list and the per-scenario JIT columns change substance; prose updates are confined to the correction notice.

## Probe-Verify Step

After editing the harness and before re-running the full suite, run the probe in isolation and capture its output:

```
bun run benchmark/probe-jsc.ts
```

Verify the `[fn-arg]` block shows a real non-zero number for `numberOfDFGCompiles(probeHot)`. If the number is `0` or `undefined`, the fix is not complete — diagnose before proceeding. The expected value on Bun 1.3.8 after 1M iterations is typically 1 or 2 (DFG fires once, FTL may fire once more).

Then run a single scenario through the harness as a smoke test:

```
bun run bench
```

Check the resulting `results.json` for at least one scenario with `dfgCompilesDelta !== null` and `dfgCompilesDelta >= 0`. That is the acceptance signal that the wiring change in §2 took effect. If every scenario still shows `null`, the wiring is wrong.

## Acceptance Criteria

- [ ] `bun run typecheck` exits 0.
- [ ] `bun test` exits 0 (tests are unchanged — this is a regression guard only).
- [ ] `benchmark/probe-jsc.ts` output includes a `[fn-arg]` block where at least `numberOfDFGCompiles(probeHot)` shows a real non-zero integer.
- [ ] `benchmark/harness.ts` calls `dfgCompilesFn(scenario.fn)` (not zero-arg) at both bracket points inside `bench()`, and passes `scenario.tick` (or the sustained equivalent) inside `benchSustained()`. Grep confirms no `dfgCompilesFn()` with zero arguments remains.
- [ ] `totalCompileTimeMsDelta` field exists on both `BenchResult` and `SustainedResult` and is populated by `totalCompileTimeFn()` before/after the measurement window.
- [ ] `.chief/milestone-2/_report/task-10/results.json` has been overwritten and shows at least one scenario with `dfgCompilesDelta !== null`.
- [ ] `.chief/milestone-2/_report/task-10/benchmark.md` has been overwritten with a new "Correction — JIT counter measurement fixed in milestone-3/task-1" section near the top and populated `dfgΔ` columns.
- [ ] `.chief/milestone-2/_report/task-10/bun-jsc-probe.txt` has been overwritten with the corrected probe output.
- [ ] `.chief/milestone-2/_report/task-7/**` and `.chief/milestone-2/_report/task-9/**` are byte-identical to their pre-task state (verify via `git diff` on those paths — the diff must be empty).
- [ ] Zero edits anywhere under `src/**`, `tests/**`, `examples/**`, `package.json`, `tsconfig.json`, `CLAUDE.md`, `.chief/_rules/**`, `.chief/milestone-1/**`, `.chief/milestone-2/_goal/**`, `.chief/milestone-2/_contract/**`, or `.chief/milestone-2/_plan/**`.
- [ ] No new files or scripts created under `/tmp`, `$TMPDIR`, or any location outside the repo. Every diagnostic, probe, and smoke-test lives as a committed file under `benchmark/`.
- [ ] `package.json` is byte-identical.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-3/_plan/_todo.md`** — the chief-agent owns that checklist.

## Out of Scope

- Any `src/**` change. Touching source code is forbidden in this task.
- Rewriting task-10's narrative beyond the correction notice.
- Touching task-7 or task-9 report files.
- Adding new benchmark scenarios (the milestone-3 B3-column scenario lands in task-4).
- Renaming or removing any existing `BenchResult` / `SustainedResult` field. `totalCompileTimeMsDelta` is appended only.
- Changing `numberOfDFGCompiles` bracket position or which phase of the measurement it spans (keep task-10's bracket — it was correctly placed, just incorrectly invoked).
- Capacity / duration / warmup / iteration count tuning for any scenario.
- Milestone-3 source code work — that begins in task-2.

## Notes

- The blind spot in the fix is inherited from the milestone-2 summary: `numberOfDFGCompiles(wrapper)` does not capture recompiles of nested functions called inside the wrapper. `totalCompileTime()` delta is the process-global signal that does. Surface this limitation in the JSDoc of the new field and in the correction notice of `benchmark.md`.
- On Bun 1.3.x, `totalCompileTime()` returns milliseconds since process start. Sample before/after the window and subtract. A small positive delta (e.g. 10–50ms) is normal during the first warmup; a large positive delta (hundreds of ms) in the middle of a supposedly-hot timing loop is the signal that some nested function is being recompiled and that the codegen is not monomorphic.
- This task writes the corrected JIT data into task-10's directory on purpose: task-10 is still the narrative home of "here is the CPU / JIT / RSS / time-series evidence base"; the correction is a fix to that evidence base, not a new report. Milestone-3's actual benchmark report for the SoA rewrite lands in task-4's directory.
- Do NOT retry failing runs by mutating scenario workloads. If a scenario genuinely cannot be measured on the current Bun version, leave its JIT columns as `null` and document which scenario and which counter in the correction notice. The goal is honest data, not green boxes.
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes.
