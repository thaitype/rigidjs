# Task 10 — Benchmark Instrumentation Extensions (CPU, JIT, High-Water RSS, Heap Time-Series)

## Objective

Extend the existing benchmark harness (`benchmark/harness.ts`) with four additive instrumentation categories so that the B1–B9 evidence base gets stronger without changing any existing scenario's behavior or measured workload. Task-7 shipped the B1/B2/B3/B7 one-shot suite, task-8 fixed the allocation-pressure measurement via `liveObjectCount(heapStats())`, and task-9 added sustained-load B8/B9 with per-tick latency distributions and produced hard evidence that RigidJS wins on tail latency at 100k+ capacity. The open question task-10 answers is: **what additional signals would make that evidence harder to argue with?**

Four additions, all purely additive:

1. **CPU usage comparison** via `process.cpuUsage()` — user / system / total CPU microseconds across each measurement window for both `bench()` and `benchSustained()`.
2. **JIT recompile counter** via `numberOfDFGCompiles()` (and any sibling JIT counters exposed by `bun:jsc`) — before/after delta across the window. Gracefully records `null` if the Bun version does not expose the counter.
3. **High-water RSS** — peak `process.memoryUsage().rss` observed during the measurement window, not just the end-of-window snapshot.
4. **Per-tick heap time-series for B8** (sustained only) — a throttled, bounded sample of `liveObjectCount(heapStats())` and RSS per tick-group, so the report can visualize JS sawtooth vs RigidJS flatline via an ASCII sparkline.

This task is purely additive to the benchmark suite. It must not touch `src/**`, `tests/**`, `examples/**`, `package.json`, `tsconfig.json`, the design spec, `CLAUDE.md`, `.chief/_rules/**`, `.chief/milestone-2/_contract/**`, or `.chief/milestone-2/_goal/**`. It must not modify the task-7 or task-9 report files. It writes new reports to `.chief/milestone-2/_report/task-10/`.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` — §7.1 metrics (notes `numberOfDFGCompiles()`, `MIMALLOC_SHOW_STATS`, high-water RSS, CPU; this task implements the inline-safe subset)
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-7.md` — format reference + one-shot harness contract
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-8.md` — `liveObjectCount(heapStats())` helper + anti-DCE pattern
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-9.md` — sustained harness contract
9. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-9/benchmark.md` — prior sustained results narrative
10. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-9/results.json` — prior sustained raw data
11. Existing benchmark source:
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b1-struct-creation.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b2-insert-remove-churn.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b3-iterate-mutate.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b7-nested-struct.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b8-sustained-churn.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b9-heap-scaling.ts`

## Scope Guardrails

- **Benchmark-only surface area.** All edits land under `benchmark/**` plus new files under `.chief/milestone-2/_report/task-10/`. Nothing else.
- **No edits to `src/**`, `tests/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, `.chief/milestone-2/_contract/**`, `.chief/milestone-2/_goal/**`, the design spec, `tsconfig.json`, or `package.json`.** If it appears any of these need changes, stop and escalate.
- **No new dependencies.** `package.json`'s `dependencies`, `devDependencies`, and `peerDependencies` stay byte-identical. The `bench` script is unchanged.
- **Public API only.** Benchmark files import exclusively from `'../src/index.js'` / `'../../src/index.js'`. No deep imports into `src/struct/**` or `src/slab/**`.
- **Existing B1–B9 scenario behavior is byte-identical.** No changes to `Scenario`/`SustainedScenario` semantics, workload shape, warmup counts, iteration counts, durations, capacities, or tick bodies. Instrumentation wraps the measurement loop from the outside and performs strictly read-only probes (`process.cpuUsage()`, JIT counter reads, RSS reads) — it does not allocate inside the hot inner loops and must not perturb the measured work.
- **Task-7 and task-9 report files are NOT modified.** Task-10 writes to its own new directory `.chief/milestone-2/_report/task-10/`.
- **TypeScript strict mode applies.** Zero `any` in exported signatures. New fields use concrete numeric types (`number | null` where a counter might be unavailable).
- **No new benchmark files require a `src/` surface change.** The instrumentation is entirely harness-side.
- **Additive only to `BenchResult` / `SustainedResult`.** New fields are appended; no renames, no reorders, no removals. Existing JSON consumers from task-7 and task-9 keep working — they just ignore fields they do not know about.
- **Benchmarks are not tests.** No benchmark file lives under `tests/`. `bun test` must not pick up any benchmark code.
- **No `/tmp` scripts. Ever.** Any utility needed to gather benchmark signal (probes, diagnostics, environment checks, sampling calibration) MUST live under `benchmark/` as a committed, typechecked file runnable via `bun run benchmark/<name>.ts`. Benchmark probes are benchmark tools — they need to be re-runnable by the next person on a different Bun version, machine, or milestone. Writing to `/tmp` is an acceptance-criteria violation even if the script is deleted at task end. This rule is permanent and inherited by all future benchmark-adjacent tasks.

## Deliverables

### 1. `benchmark/harness.ts` — instrument `bench()` and `benchSustained()`

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`. All changes are additive.

#### 1a. Probe `bun:jsc` JIT counter availability

Add a module-level initialization block near the top of the file (after the existing `heapStats` import) that imports everything from `bun:jsc` and picks out JIT counters at runtime:

```ts
import * as jsc from 'bun:jsc'

// Resolved at module load. Any counter absent on this Bun version is null.
const dfgCompilesFn: (() => number) | null =
  typeof (jsc as Record<string, unknown>).numberOfDFGCompiles === 'function'
    ? ((jsc as Record<string, unknown>).numberOfDFGCompiles as () => number)
    : null
// Same pattern for any sibling counter the builder finds by enumerating
// Object.keys(jsc) in the probe step (§3). Known candidates to check:
// numberOfDFGCompiles, numberOfFTLCompiles, numberOfOSRExits, numberOfOSREntries.
// Only include counters that actually exist on the current Bun version.
```

Builder must enumerate `Object.keys(require('bun:jsc'))` during the probe step (§3) and either include or omit each candidate counter based on what the live Bun version actually exposes. If `numberOfDFGCompiles` is absent, the field remains declared in `BenchResult` / `SustainedResult` but is written as `null` — do NOT try to implement a workaround and do NOT fail the scenario.

Cast `jsc` through `Record<string, unknown>` once at the top to satisfy `verbatimModuleSyntax` + strict mode without `any`. Document this with a one-line comment.

#### 1b. Extend `BenchResult` with four new fields

Append (do not reorder) the following to `BenchResult`:

```ts
export interface BenchResult {
  name: string
  opsPerSec: number
  heapObjectsBefore: number
  heapObjectsAfter: number
  heapObjectsDelta: number
  allocationDelta: number | null
  retainedAfterGC: number | null
  heapSizeMB: number
  rssMB: number
  p50Us: number
  p99Us: number
  // --- task-10 additions (appended only) ---
  cpuUserUs: number
  cpuSystemUs: number
  cpuTotalUs: number
  dfgCompilesDelta: number | null
  ftlCompilesDelta: number | null       // include only if counter present; else null
  osrExitsDelta: number | null          // include only if counter present; else null
  highWaterRssMB: number
}
```

The `ftlCompilesDelta` and `osrExitsDelta` fields are declared unconditionally on the interface so JSON shape is stable regardless of Bun version. On versions where those counters are not exposed, the harness writes `null`. If the probe in §3 finds zero additional counters beyond `numberOfDFGCompiles`, the builder still includes these fields in the interface — that is intentional forward compatibility, not dead code.

#### 1c. Instrument `bench()` to populate the new fields

Modify the existing `bench()` body without changing its outer signature. Keep all existing phases in the same order (setup → optional allocation phase → warmup → GC+sleep → heapBefore → timing loop → GC+sleep → heapAfter → teardown). Wrap the warmup-through-heapAfter window with the new instrumentation:

1. Before the warmup call, read `const cpuStart = process.cpuUsage()` and `const jitStart = { dfg: dfgCompilesFn?.() ?? null, ftl: ..., osrExits: ... }`. The JIT snapshot only calls functions that `!== null`; for missing counters the snapshot stores `null`.
2. Track high-water RSS across the timing window using a strategy with ≤1% overhead on ops/sec (see §Design note "RSS sampling strategy for `bench()`"). The default strategy is: poll `process.memoryUsage().rss` every `Math.max(1, Math.floor(iterations / 16))` iterations inside a cheap `(i & mask) === 0` branch, update a running `highWaterRssBytes` max. Builder may instead use `setInterval` polling — but whichever approach is chosen, the builder MUST measure the resulting ops/sec delta against task-8 and task-9 baselines and document the ≤2% overhead assertion in the Probe-Verify output (§5). Also sample RSS once at the start of the window and once at the end; the high-water value is `max(initialRss, endRss, any in-loop samples)`.
3. After the timing loop closes and the post-loop `Bun.gc(true)` + sleep complete, read `const cpuEnd = process.cpuUsage(cpuStart)` and `const jitEnd = { dfg: dfgCompilesFn?.() ?? null, ... }`. `process.cpuUsage(cpuStart)` returns the delta directly in microseconds; `cpuUserUs = cpuEnd.user`, `cpuSystemUs = cpuEnd.system`, `cpuTotalUs = cpuEnd.user + cpuEnd.system`.
4. Compute each `<name>Delta` as `jitEnd.<name> !== null && jitStart.<name> !== null ? jitEnd.<name> - jitStart.<name> : null`.
5. Populate `highWaterRssMB = highWaterRssBytes / (1024 * 1024)` rounded to 2 decimals.
6. Include the new fields in the returned `BenchResult`.

Rules:
- The CPU sampling points bracket the **timing loop plus its preceding warmup and following GC**. Rationale: including warmup captures JIT compile time (which is CPU work), and including the post-loop GC captures GC CPU cost (which is a core signal for the thesis). Do NOT move the CPU bracket to isolate only the timing loop — the goal is full-window CPU accounting, not per-iteration CPU.
- The JIT counter bracket uses the same window as the CPU bracket, for the same reason: we want to see JIT compiles triggered anywhere in the scenario, including warmup.
- RSS polling MUST be cheap. `process.memoryUsage()` is a syscall. If the mask-based in-loop polling shows more than 2% ops/sec regression vs the task-8/task-9 baselines during probe-verify (§5), the builder must fall back to sampling RSS only at scenario boundaries (start / end / once halfway via a checkpoint at `iterations / 2`) and document the fallback in `benchmark.md`.

#### 1d. Instrument `benchSustained()` to populate the new fields

Extend `SustainedResult` with the same additions:

```ts
export interface SustainedResult {
  name: string
  capacity?: number
  ticksCompleted: number
  meanTickMs: number
  stdDevTickMs: number
  p50TickMs: number
  p99TickMs: number
  p999TickMs: number
  maxTickMs: number
  allocationDelta: number | null
  heapSizeMB: number
  rssMB: number
  // --- task-10 additions (appended only) ---
  cpuUserUs: number
  cpuSystemUs: number
  cpuTotalUs: number
  dfgCompilesDelta: number | null
  ftlCompilesDelta: number | null
  osrExitsDelta: number | null
  highWaterRssMB: number
  /** Per-tick heap time-series (sampled every Nth tick, capped at 500 entries). */
  heapTimeSeries: HeapSample[] | null
}

export interface HeapSample {
  tick: number           // tick index at the moment of sampling
  liveObjects: number    // liveObjectCount(heapStats())
  rssMB: number          // process.memoryUsage().rss / (1024*1024), 2 decimals
}
```

Modify `benchSustained()` to:

1. Read CPU / JIT counters at the same point as `bench()`: immediately before the warmup tick loop, and immediately after the post-window `Bun.gc(true) + sleep`.
2. Track high-water RSS by sampling `process.memoryUsage().rss` at the start of each tick (cheap relative to a tick which contains thousands of inserts/removes/iterations — see §Design note "Why per-tick RSS polling is affordable in sustained mode"). Update a running max. Do NOT put the sample inside the tick body — only at the outer loop boundary.
3. Collect `heapTimeSeries` during the timing window using a throttled strategy:
   - Choose an initial sampling stride `N = 50`. Before the timing loop, estimate how many samples will fit inside the 500-entry cap given the scenario's `durationMs` and expected tick rate. If the estimate exceeds 500, increase `N` until the projected sample count stays ≤500. Use the task-9 ticksCompleted numbers as a reasonable upper bound on expected tick rate: B8 JS baseline ~ few thousand ticks per 10s window, B8 RigidJS ~ tens of thousands per 10s window. A default rule: `N = max(50, ceil(expectedTicks / 500))`.
   - Inside the sustained timing loop, at `(ticksCompleted % N) === 0`, push one `HeapSample` entry using `liveObjectCount(heapStats())` and the current RSS. Hard-cap the array at 500 entries — if the cap is reached, stop collecting but keep the timing loop running.
   - The time-series collection only runs for B8 (sustained-state churn). B9 scenarios are short (2s per capacity) and their value is the scaling curve, not the micro-trajectory. Pass the time-series collection in as an opt-in via a new optional field on `SustainedScenario` named `collectHeapTimeSeries?: boolean` — default `false`. B8 scenarios set it to `true`; B9 scenarios leave it unset. If the flag is `false`, `heapTimeSeries` on the returned `SustainedResult` is `null`.
   - **This is the one exception to "no changes to existing scenarios":** `b8-sustained-churn.ts` gets the `collectHeapTimeSeries: true` flag added. No other scenario file changes. Document the flag in the scenario file with a one-line comment. The workload, durations, warmup counts, and FIFO logic are untouched.
4. After the loop, populate `cpuUserUs` / `cpuSystemUs` / `cpuTotalUs` and the JIT deltas and the `highWaterRssMB` on the returned `SustainedResult`.

#### 1e. ASCII sparkline helper

Add:

```ts
export function formatSparkline(series: readonly number[]): string
```

- Returns a 40-character (or series-length, whichever is smaller) string rendered from the Unicode block characters `▁▂▃▄▅▆▇█`.
- Normalizes the input series to 8 buckets based on min/max of the series.
- If `series.length <= 1` or `min === max`, returns a constant sparkline of `▄` repeated (flat line).
- If `series.length > 40`, downsample by taking every `Math.ceil(length / 40)`th element before rendering (simple striding; no interpolation).
- Pure function, no side effects, no hidden allocations that matter for correctness.

#### 1f. Update `formatTable()` / `formatSustainedTable()`

Extend both table formatters to include the new signals. The builder has one of two choices for each table and must pick one per table and document the choice inline:

- **Widen-the-table strategy:** add new columns without removing any. The terminal output may exceed 120 chars; that is acceptable for this report surface.
- **Drop-a-stale-column strategy:** remove a column that is now redundant to make room. For `formatTable()`, `heapΔ` from task-7 is a candidate to drop — it was superseded by `allocationDelta` from task-8. For `formatSustainedTable()`, `stdDevMs` is a candidate to drop since p99/p999/max already convey tail behavior.

Required additions regardless of strategy:
- `formatTable()` must show columns for: CPU total ms (`cpuMs` = `cpuTotalUs / 1000`, 1 decimal), `dfgΔ` (render `null` as `-`), `hwRssMB` (1 decimal).
- `formatSustainedTable()` must show the same three columns. The sparkline column is NOT in the table (it goes into the markdown report body only — see §2).

Header row and data rows must stay aligned. Builder documents the strategy choice in a one-line comment above each formatter.

### 2. `benchmark/run.ts` — new report directory, extend report content

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`. All changes are additive.

- The existing task-7 flow (write `.chief/milestone-2/_report/task-7/results.json` + `benchmark.md`) stays byte-for-byte in place. Do not modify it.
- The existing task-9 flow (write `.chief/milestone-2/_report/task-9/results.json` + `benchmark.md`) stays byte-for-byte in place. Do not modify it.
- **After** both existing flows complete, add a new flow that writes to `.chief/milestone-2/_report/task-10/results.json` and `.chief/milestone-2/_report/task-10/benchmark.md`.

Rationale for preserving task-7 and task-9 outputs: those reports are the historical record of what we knew at each step. Task-10 adds instrumentation and writes a fresh report with the enriched data; it does not replace the old ones.

Concretely for the new flow:

1. Reuse the already-collected `b1/b2/b3/b7` one-shot results and `b8/b9` sustained results from the existing flows. Do not re-run the benchmarks — the single run of each scenario already carries the new instrumentation fields since §1 instrumented the harness itself.
2. Create the directory recursively via `mkdir('.chief/milestone-2/_report/task-10', { recursive: true })`.
3. Write `.chief/milestone-2/_report/task-10/results.json`:

   ```json
   {
     "meta": {
       "bunVersion": "...",
       "platform": "...",
       "arch": "...",
       "date": "ISO8601",
       "xlEnabled": false,
       "jitCountersAvailable": ["numberOfDFGCompiles"]
     },
     "oneShot": [ BenchResult, ... ],
     "sustained": {
       "b8": [ SustainedResult, ... ],
       "b9": [ SustainedResult, ... ]
     }
   }
   ```

   `meta.jitCountersAvailable` lists the exact `bun:jsc` function names that were found at probe time. Consumers can cross-reference this when interpreting `null` delta fields.

4. Write `.chief/milestone-2/_report/task-10/benchmark.md` with these sections:
   - **Top matter**: bun version, platform/arch, date, xlEnabled flag, `jitCountersAvailable` list.
   - **Introduction** (2–4 sentences): task-7 shipped B1–B7 with object-count evidence, task-8 corrected the measurement, task-9 added sustained B8/B9 and established RigidJS tail-latency wins at 100k+ scale. Task-10 adds four instrumentation categories — CPU comparison, JIT recompile counters, high-water RSS, per-tick heap time-series — so the same workloads produce a richer evidence base.
   - **## What This Means For You (End-User Impact)** — **NEW for task-10.** This section MUST come immediately after Introduction and before the technical tables. It is the most important new requirement of task-10: translate the raw numbers into plain-language outcomes an application developer cares about. No jargon. No "p99.9" without a "which means". Required subsections:
     - **### Memory you'll actually use** — 2–3 sentences + one plain-language table. Compare the settled RSS (`endRssMB`) and high-water RSS (`hwRssMB`) of JS vs RigidJS for B8 and the largest B9 capacity. Translate to a developer sentence like "For 100k particles, your app's memory footprint is ~X MB with plain JS vs ~Y MB with RigidJS — a difference of Z MB that matters when your process is competing for RAM with a browser or a database." Include absolute MB deltas, not percentages, because end users budget memory in MB. Also mention peak-vs-settled: "JS's memory balloons to H MB during bursts before GC reclaims back to E MB — RigidJS stays flat at F MB." If the numbers contradict the thesis at any scale, say so directly: "at 10k capacity, RigidJS actually uses more memory than plain JS because of fixed slab overhead."
     - **### CPU cost (is your app faster or slower?)** — 2–3 sentences + one plain-language table. Compare the total CPU time (`totalMs`) AND the wall time (`wallMs`) for the same workloads. Translate to a developer sentence like "A 10-second RigidJS particle sim uses X seconds of CPU compared to Y seconds for the plain JS version — so RigidJS is N% more/less CPU-expensive per unit of work done." If `blockedMs` is meaningfully larger for JS (the GC-in-kernel story), surface that in user terms: "plain JS spent X% of its wall time blocked in garbage collection — your users see this as stutters or jank." If RigidJS's CPU cost is higher, say so honestly: "RigidJS is N% more CPU-hungry per operation, which means on a battery-powered laptop your fans will spin up sooner." Do not hide negative findings.
     - **### Will my users notice a difference?** — 2–4 sentences of qualitative framing. Use the B8 sustained-churn max-tick and p99 data to answer the question in concrete user-visible terms. For a game at 60fps, one frame is 16.67ms — how many frames would each variant drop in a 10s window? For a server handling requests, what percentage of requests would hit a >10ms pause? Translate max-tick spikes into "N dropped frames per 10 seconds" or "X% of requests see a stall longer than the blink of an eye (~100ms)". If the data says "users won't notice at this scale", say that. If it says "users will feel the difference at Y scale or above", say that with numbers.
     - **### When should I use RigidJS vs plain JS?** — 3–5 sentence decision guide based on the actual numbers collected across B1–B9. Framed as: "Use RigidJS if your app has A, B, or C characteristics (sustained allocation, >N entities, latency SLA under M ms). Stick with plain JS if your app has D or E characteristics (<N entities, burst-only workload, no latency SLA, battery-constrained)." Anchor every recommendation to a specific benchmark number from the report — do not hand-wave.

     Tone guardrails for this section:
     - Write for a working application developer, not a compiler engineer
     - No greek letters, no percentiles without a real-world analogy
     - Every claim must cite the specific benchmark and number it comes from
     - Absolute numbers (MB, ms, frames, requests) preferred over ratios
     - Be honest about RigidJS's losses — do NOT sugarcoat at small scales or on raw throughput
     - Do NOT use marketing language ("blazing fast", "game-changing", "revolutionary")
     - If the numbers don't support a claim, do not make the claim

   - **## CPU usage comparison** — one table per window type (one-shot B1/B7 and sustained B8 — skip B2/B3 for brevity since their CPU story is uninteresting by construction). Columns: `name`, `wallMs` (derived from opsPerSec × iterations for `bench` or the observed window duration for `benchSustained`), `userMs`, `systemMs`, `totalMs`, `blockedMs` where `blockedMs = max(0, wallMs - totalMs)`. 2–4 sentences interpreting the JS vs RigidJS gap — specifically whether system CPU or blocked time diverges meaningfully between variants. See §Design note "Why CPU usage matters even on single-threaded Bun" for the interpretive framework.
   - **## JIT compile deltas** — one table across all scenarios (B1–B9). Columns: `name`, `dfgΔ`, `ftlΔ`, `osrExitsΔ`. `null` renders as `-`. 2–4 sentences on whether JS variants show more DFG/FTL compiles under churn than RigidJS (hidden-class thrash detection).
   - **## High-water RSS** — one table across all scenarios. Columns: `name`, `endRssMB` (existing `rssMB`), `hwRssMB`, `deltaMB` (hw − end). Short interpretation: does JS peak meaningfully above its settled RSS on sustained scenarios? Does RigidJS stay flat?
   - **## B8 heap time-series** — one subsection per B8 variant (two total: JS baseline, RigidJS). Each subsection shows:
     - The sampling stride `N` used
     - The number of samples collected
     - An ASCII sparkline of the `liveObjects` series via `formatSparkline()`
     - An ASCII sparkline of the `rssMB` series
     - Min / max / mean of `liveObjects` across the series
     - 1–2 sentences on whether the sawtooth-vs-flat visual matches the thesis
   - **## Verdict** — 1 paragraph updating the task-9 verdict with the new signals. Does the CPU data, JIT data, RSS peak data, and heap time-series corroborate or contradict the task-9 finding that RigidJS wins on tail latency at 100k+ capacity? Write honestly — if the new signals weaken the previous narrative, say so. Same rule as task-9: the task succeeds even if the new data is inconvenient.
   - **## Caveats** — single-run numbers, machine-dependent, JIT counters may be missing on some Bun versions (say which if applicable), RSS polling adds small overhead (state the measured overhead).
   - Final line: reference to `.chief/milestone-2/_report/task-10/results.json`.

5. Exit 0 on success. Uncaught exceptions surface naturally.

### 3. Probe step — `benchmark/probe-jsc.ts` as a committed utility

As the **first** step of the builder's execution, before editing `harness.ts`, create a permanent probe utility at `benchmark/probe-jsc.ts` and run it to enumerate the live Bun version's `bun:jsc` surface. This file is a **deliverable**, not a throwaway — it must be committed, typechecked, and runnable by anyone via `bun run benchmark/probe-jsc.ts` for as long as the repo exists.

**File contents** (baseline — builder may extend):

```ts
// benchmark/probe-jsc.ts
// Enumerates the `bun:jsc` module surface for the current Bun runtime and
// prints each exposed function's name and (if parameterless) its return value.
// Used by task-10 to decide which JIT recompile / OSR counters to wire into
// the benchmark harness, and re-runnable any time the Bun version changes.
//
// Usage:  bun run benchmark/probe-jsc.ts
// Capture: bun run benchmark/probe-jsc.ts > .chief/milestone-2/_report/task-10/bun-jsc-probe.txt

import * as jsc from 'bun:jsc'

const keys = Object.keys(jsc).sort()
console.log('# bun:jsc exposed keys')
console.log(JSON.stringify(keys, null, 2))
console.log()
console.log('# parameterless function probe')

for (const key of keys) {
  const v = (jsc as Record<string, unknown>)[key]
  if (typeof v !== 'function') continue
  try {
    const result = (v as () => unknown)()
    console.log(`${key}(): ${String(result)}`)
  } catch (e) {
    console.log(`${key}(): <throws: ${(e as Error).message}>`)
  }
}
```

**Requirements:**
- The file lives at `benchmark/probe-jsc.ts` permanently. It is NOT deleted at task end.
- It has a top-of-file JSDoc block explaining its purpose and usage.
- It is typechecked by `bun run typecheck` automatically via the repo's default tsconfig resolution.
- Running `bun run benchmark/probe-jsc.ts` exits 0 and prints the keys + parameterless probe output.
- The builder captures the stdout once during task-10 into `.chief/milestone-2/_report/task-10/bun-jsc-probe.txt` as a historical record of which counters existed on the task-10 run-date. The captured file is a deliverable; the probe script that produced it is also a deliverable.
- Future contributors (task-11, milestone-3, etc.) can re-run `bun run benchmark/probe-jsc.ts` any time they want to check the current Bun version's JIT counter surface. The probe is part of the benchmark toolkit.

Use the probe output to decide which JIT counters to wire into the harness in §1a. If `numberOfDFGCompiles` is missing, record `null` in `BenchResult` / `SustainedResult` and document which counters were unavailable in `benchmark.md` under Caveats.

### 4. Verify no task-7/task-9 report files are rewritten

After the new flow runs, `git diff --stat -- .chief/milestone-2/_report/task-7/ .chief/milestone-2/_report/task-9/` must print nothing (or at most show identical content if mtimes changed). If any content differs, the builder has accidentally modified the existing reports — stop and investigate.

### 5. Probe-verify the new fields with live numbers

After the edits, run `bun run bench` once and inspect `.chief/milestone-2/_report/task-10/results.json` and `benchmark.md`. Sanity checks (all must pass before the task is declared complete):

**Overhead budget:**
- B1–B7 one-shot `opsPerSec` values are within **5%** of the task-8 numbers in `.chief/milestone-2/_report/task-7/results.json`. Rationale: RSS polling and CPU sampling add a small fixed cost per scenario but should not materially move per-op throughput.
- B8 `ticksCompleted` values are within **10%** of the task-9 numbers in `.chief/milestone-2/_report/task-9/results.json`. Rationale: B8's tight tick loop is the most sensitive to added sampling; the 10% budget covers the per-tick RSS read plus the periodic heap sample.
- `bun run bench` total wall time is ≤ **120 seconds** with no env vars (task-9 baseline was ~60s; task-10 has a ~10% duration budget for added polling overhead).

**Field population:**
- Every one-shot entry in `oneShot` has `cpuUserUs`, `cpuSystemUs`, `cpuTotalUs`, `highWaterRssMB` as finite positive numbers.
- Every sustained entry in `sustained.b8` and `sustained.b9` has the same.
- `dfgCompilesDelta` is either a non-negative integer or `null`. If `null`, `meta.jitCountersAvailable` must not include `numberOfDFGCompiles`.
- `cpuTotalUs` is approximately `cpuUserUs + cpuSystemUs` for every entry (±1 µs for rounding).
- `highWaterRssMB >= rssMB` for every entry (the high-water should never be below the final snapshot).
- `sustained.b8[*].heapTimeSeries` is a non-empty array of length ≤500 for both B8 variants. If either variant's series is empty or contains only zeros, investigate before shipping — that indicates the sampling hook is broken.
- `sustained.b9[*].heapTimeSeries` is `null` for all B9 entries (time-series collection is B8-only by design).

**Report content:**
- `benchmark.md` contains all sections listed in §2: Introduction, CPU comparison, JIT deltas, High-water RSS, B8 heap time-series (with sparklines), Verdict, Caveats.
- Each B8 variant's sparkline section renders non-trivially (not all flat `▄` unless the series truly had `min === max`). For JS baseline the sparkline should show the sawtooth visually; for RigidJS it should be roughly flat. If both look flat, investigate — either the sampling is too coarse or the cap is being hit too quickly.

If any sanity check fails, the builder must stop, investigate, and fix — not ship the broken numbers.

## Acceptance Criteria

- [ ] `bun run bench` exits 0 within ~120 seconds wall time with no env vars
- [ ] `bun run bench` prints the existing task-7 one-shot table and the existing task-9 sustained table with their new columns (`cpuMs`, `dfgΔ`, `hwRssMB`); header/data row alignment is preserved
- [ ] `.chief/milestone-2/_report/task-10/results.json` exists, parses as valid JSON, and has top-level `meta`, `oneShot`, `sustained` keys, with `sustained.b8` and `sustained.b9` sub-arrays
- [ ] `meta.jitCountersAvailable` is an array of strings listing the `bun:jsc` counter function names actually present on the running Bun version
- [ ] Every `oneShot` entry has numeric `cpuUserUs`, `cpuSystemUs`, `cpuTotalUs`, `highWaterRssMB` fields, plus numeric or `null` `dfgCompilesDelta` / `ftlCompilesDelta` / `osrExitsDelta` fields
- [ ] Every `sustained.b8` and `sustained.b9` entry has the same instrumentation fields plus the new `heapTimeSeries` field (non-empty array for B8, `null` for B9)
- [ ] `sustained.b8[*].heapTimeSeries` is non-empty, length ≤500, and contains `HeapSample` objects with `tick`, `liveObjects`, `rssMB` fields
- [ ] `.chief/milestone-2/_report/task-10/benchmark.md` exists and contains all sections listed in §2 (Introduction, **What This Means For You**, CPU comparison, JIT deltas, High-water RSS, B8 heap time-series, Verdict, Caveats)
- [ ] The **What This Means For You** section contains all four required subsections (Memory you'll actually use, CPU cost, Will my users notice, When should I use RigidJS) and placing it immediately after Introduction and before CPU comparison
- [ ] Every quantitative claim in the **What This Means For You** section cites the specific benchmark name it comes from (e.g. "per B8 RigidJS: 5.79ms max tick"); claims without a citation are a failure condition
- [ ] The **What This Means For You** section contains at least one honest statement about where RigidJS loses or is neutral (small capacity RSS overhead, raw throughput cost, etc.) — if every sentence is positive, the builder has not written an honest report
- [ ] `.chief/milestone-2/_report/task-10/benchmark.md` renders two ASCII sparklines per B8 variant (one for `liveObjects`, one for `rssMB`) via `formatSparkline()`
- [ ] `.chief/milestone-2/_report/task-10/bun-jsc-probe.txt` exists and captures the probe output from §3
- [ ] `.chief/milestone-2/_report/task-7/results.json` and `.chief/milestone-2/_report/task-7/benchmark.md` are byte-identical in content to the post-task-8 state (only mtimes may change)
- [ ] `.chief/milestone-2/_report/task-9/results.json` and `.chief/milestone-2/_report/task-9/benchmark.md` are byte-identical in content to the post-task-9 state (only mtimes may change)
- [ ] `bun test` still exits 0 with 155 prior tests green
- [ ] `bun run typecheck` exits 0 and includes `benchmark/**` in its coverage
- [ ] `bun run examples/particles.ts` still prints the same deterministic four-line summary from task-6
- [ ] B1–B7 one-shot `opsPerSec` values are within 5% of the task-8 baseline in `.chief/milestone-2/_report/task-7/results.json`
- [ ] B8 `ticksCompleted` values are within 10% of the task-9 baseline in `.chief/milestone-2/_report/task-9/results.json`
- [ ] `grep -rn "Proxy" src/` returns zero matches
- [ ] `grep -rn "from '.*src/struct\|from '.*src/slab" benchmark/` returns zero matches
- [ ] `grep -rn "heapStats().objectCount" benchmark/` returns zero matches (must only use `liveObjectCount(heapStats())`)
- [ ] `grep -rn "benchmark" tests/` returns zero matches
- [ ] `git diff --stat -- src/ tests/ examples/ package.json tsconfig.json CLAUDE.md .chief/_rules/ .chief/milestone-2/_contract/ .chief/milestone-2/_goal/ .chief/_template/` prints nothing
- [ ] Existing exports from `benchmark/harness.ts` (`bench`, `runAll`, `formatTable`, `benchSustained`, `benchScaling`, `formatSustainedTable`, `BenchResult`, `Scenario`, `SustainedScenario`, `SustainedResult`, `liveObjectCount`) are unchanged in name and outer signature; `BenchResult` / `SustainedResult` / `SustainedScenario` are extended with new fields only (appended)
- [ ] The new `formatSparkline` is exported from `benchmark/harness.ts`
- [ ] No `any` in exported signatures; the single `Record<string, unknown>` cast at the `bun:jsc` import site has a one-line explanatory comment
- [ ] For B8 variants, the JS baseline heap-time-series sparkline shows visible variation (not flat `▄`×40). If both B8 sparklines are flat, builder investigated and documented the cause before declaring complete
- [ ] The RSS polling overhead is documented in `benchmark.md` under Caveats, with the measured ops/sec delta vs the task-8 baseline
- [ ] No new dependencies in `package.json`; `bench` script unchanged
- [ ] `benchmark/probe-jsc.ts` exists as a committed, typechecked utility (not deleted at task end) and is runnable via `bun run benchmark/probe-jsc.ts`
- [ ] `.chief/milestone-2/_report/task-10/bun-jsc-probe.txt` contains the captured stdout from running the probe at task-10 time
- [ ] No file was written to `/tmp` during task execution (violates the "No `/tmp` scripts" guardrail)

## Out of Scope (Explicit)

- Regression gates, CI thresholds, multi-run averaging, statistical significance tests
- Adding scenarios B4/B5/B6 (still gated on `.iter()`, `bump()`, `vec()` — future milestones)
- `--heap-prof`, `MIMALLOC_SHOW_STATS=1`, or any profiling flags that require external tooling or restart the process — too invasive for inline benchmarks
- Plot rendering (PNG/SVG/chart libraries) — ASCII sparklines are the only visualization
- Changing B1–B9 scenario behavior, workload shape, warmup counts, iteration counts, durations, or capacities
- Fixing the task-9 spec deviation note about `durationMs * 2` latency buffer (that is baseline from task-9 and stays as-is)
- Overwriting existing task-7 or task-9 report files
- Editing `src/**`, `tests/**`, `examples/**`, `package.json`, `tsconfig.json`, `CLAUDE.md`, the design spec, or anything under `.chief/_rules/**` / `.chief/milestone-2/_contract/**` / `.chief/milestone-2/_goal/**`
- Adding new dependencies of any kind
- Renaming or reordering existing fields on `BenchResult` / `SustainedResult` / `SustainedScenario`
- Instrumenting the `allocate()` phase (it is short, one-shot, and already measured by `allocationDelta` — CPU / JIT / RSS sampling around it would add noise without signal)
- Per-tick heap time-series for B9 (too short a window to be meaningful; B8 is the right scenario for this signal)
- Parallel benchmarks across worker threads
- Recording GC pause histograms beyond what `heapTimeSeries` implicitly captures (dedicated pause histograms would require hooks the Bun runtime does not expose today)

## Design Notes

### Why CPU usage matters even on single-threaded Bun

On single-threaded Bun, user-CPU time typically tracks wall-clock time closely — the process has only one thread of execution, so "CPU spent" and "wall-clock elapsed" are nearly the same number when the program is compute-bound. That near-equality is **not** what makes CPU sampling valuable. The value is in detecting **divergences** between wall-clock and CPU time:

- **Wall ≫ user + system CPU:** the process was blocked. Either it was in an `await Bun.sleep` (not applicable inside a timed window), in a native-side JSC GC running on a background thread (applicable — JSC can offload some GC work), or stuck waiting on a kernel call. A large `blockedMs` signal on JS variants but not on RigidJS variants is direct evidence that JS ticks are paying GC pause costs that the instrumentation otherwise cannot see.
- **System CPU spike:** the kernel did meaningful work during the window. On `ArrayBuffer`-heavy paths, system CPU can spike from `mmap`/`munmap` calls that happen when large buffers are allocated or released. RigidJS allocates one large backing buffer at slab construction time and holds it for the slab's lifetime — system-CPU during B8's steady-state tick loop should be near zero. Plain JS allocating thousands of transient objects per tick triggers mostly GC work in user CPU, not system CPU, so a system-time delta between variants is a specific signal for how each variant interacts with the kernel.
- **User CPU ≈ wall for both:** the happy-path case. Both variants are compute-bound in JS-land. No additional signal, but also no contradicting signal — the CPU data is consistent with the existing tail-latency narrative.

The report interprets the CPU table by computing `blockedMs = max(0, wallMs - cpuTotalMs)` per row and calling out divergences. If blockedMs is meaningfully larger for JS than RigidJS in B8, that is independent corroboration of the task-9 finding; if it is not, the CPU signal is inconclusive and the report says so.

### Why per-tick heap sampling must be throttled

Each `heapStats()` call enumerates JSC's internal object type table (`objectTypeCounts`), and `liveObjectCount` sums across it. The cost is non-trivial — dozens to hundreds of microseconds depending on the number of distinct object types — and scales with heap complexity. Sampling every single tick on a 50,000-tick window (B8 RigidJS at ~5k ticks/sec × 10s) would add ~hundreds of milliseconds of instrumentation cost, dominating the measurement signal for the RigidJS variant specifically. Sampling every 50th tick with a 500-entry cap keeps the total instrumentation overhead below ~1% of wall time while still producing enough resolution to distinguish "flat line" from "sawtooth" visually in a 40-character sparkline.

The dynamic stride computation (`N = max(50, ceil(expectedTicks / 500))`) ensures the 500-entry cap is never hit partway through a long run — instead, the stride is increased so the samples span the full window. This matters because we want a sparkline that shows the whole trajectory, not just the first 10% of it.

### Why high-water RSS matters over end-of-window RSS

Task-7/task-9 record `rssMB` from a single `process.memoryUsage()` call at the end of the scenario, after a forced GC. That value reflects the **settled** state of the OS-level memory footprint, which is useful for comparing steady-state working sets but misses the **peak** allocation behavior. Under sustained churn, JS processes often show a sawtooth pattern in RSS: allocations drive RSS up, GC compaction brings it back down, and the cycle repeats. The settled value at the end of the window may be near the trough of the sawtooth, hiding the peak that actually matters for capacity planning. Tracking high-water RSS across the window captures the peak; the delta between `highWaterRssMB` and `rssMB` is an independent proxy for "how much does this process bounce around memory-wise under load" — a signal RigidJS should win on because its backing `ArrayBuffer` does not shrink.

### Why ASCII sparklines instead of a chart library

Zero dependencies is a hard constraint for this project (see Scope Guardrails). A chart library would require adding `chart.js`, `vega`, or similar to `devDependencies`, which is out of scope. ASCII sparklines using the Unicode block characters `▁▂▃▄▅▆▇█` give ~8 levels of resolution in a single text line, render identically in terminal output and in markdown files, work in email and pasted-snippet contexts, and require zero runtime dependencies. They are sufficient for the "flat vs sawtooth" visual distinction that this task wants to surface — we do not need pixel-perfect charts, we need enough resolution to tell the two patterns apart at a glance. For the curious reader who wants exact numbers, `results.json` carries the full `HeapSample[]` arrays.

### Why this task gets its own report directory

Task-10 does not replace any of the task-7 or task-9 findings — it strictly adds instrumentation to the same workloads. Preserving `.chief/milestone-2/_report/task-7/` and `.chief/milestone-2/_report/task-9/` as historical artifacts gives us an audit trail: task-7 shows what the first-pass measurement said (with the original allocation flaw), task-8's fix is embedded in the corrected task-7 report, task-9 shows the sustained-load evidence that established the tail-latency narrative, and task-10 shows the enriched evidence base with CPU/JIT/RSS/time-series signals. Each report captures the state of knowledge at one point in time. Overwriting earlier reports would erase the progression and make it harder to retroactively audit which signals existed when.

### RSS sampling strategy for `bench()`

The one-shot `bench()` timing loop runs thousands to millions of tight iterations. `process.memoryUsage()` is a syscall with non-trivial cost (microseconds per call on most platforms). Sampling every iteration would regress ops/sec by double-digit percents, which would violate the 5% overhead budget.

Two strategies satisfy the budget:

1. **Strided polling inside the loop.** Compute `const sampleMask = (1 << Math.max(0, Math.ceil(Math.log2(Math.max(1, iterations / 16))))) - 1` — a power-of-two mask that fires ~16 times across the whole timing window. Use `if ((i & sampleMask) === 0) { /* read rss, update max */ }` inside the loop. This adds 16 syscalls total, amortized across all iterations. For a 10s timed loop this is ~1.6 µs amortized per iteration — well below the budget.
2. **Endpoint + midpoint sampling.** Read RSS once at the start, once at `Math.floor(iterations / 2)` via a single out-of-loop branch, and once at the end. Three syscalls total. Lower overhead than strategy 1, but also lower resolution — might miss a transient peak that lived entirely in the first or last quarter of the window.

Either strategy is acceptable. Builder picks one, implements it, measures the ops/sec delta against the task-8 numbers in `.chief/milestone-2/_report/task-7/results.json`, and documents the choice and measured overhead in `benchmark.md` under Caveats. If strategy 1 fails the 5% budget, fall back to strategy 2. If strategy 2 also fails the budget (unlikely — three syscalls should be negligible), escalate to chief-agent.

### Why per-tick RSS polling is affordable in sustained mode

A B8 tick contains thousands of inserts, removes, and per-entity mutations — each tick is hundreds of microseconds to low milliseconds of work. A single `process.memoryUsage()` syscall is on the order of 1–10 µs. One syscall per tick adds ≤1% per-tick overhead even in the most tight-loop case, and the sampling captures RSS at every tick boundary, which is the ideal resolution for a sustained scenario. This is why per-tick RSS polling is the default for `benchSustained()` but not for `bench()` — the inner-loop density is fundamentally different.

### Why `formatSparkline` normalizes per-series

Absolute object counts between JS and RigidJS B8 variants differ by orders of magnitude (JS might live-count 150k–250k; RigidJS might live-count dozens — both are "correct" for their respective representations). A sparkline normalized against the JS range would render the RigidJS series as a flat line at `▁` which hides its own internal variation. Normalizing each series against its own min/max lets each sparkline show the **shape** of its trajectory independently. The surrounding table rows still carry min/max/mean so the absolute scale is not lost.

### Why `collectHeapTimeSeries` is opt-in per scenario

Adding the time-series collection unconditionally to `benchSustained()` would instrument B9 — six scenarios × three capacities × two variants — with a feature that only makes sense for the 10s B8 window. B9's 2s windows do not have enough ticks to produce a meaningful trajectory, and the instrumentation cost would eat into B9's already-tight wall-time budget. Making it an opt-in flag on `SustainedScenario` keeps the instrumentation surgical: B8 enables it, B9 does not, and the result type carries `null` for B9 entries so consumers know the field is intentionally empty.

### Timing-loop invariance for existing scenarios

The extraction in task-9 of `liveObjectCount` from inline into a named helper must not regress B1–B9 timing. Task-10's further instrumentation adds small per-loop overhead for RSS polling and per-window work for CPU/JIT sampling. The 5% (one-shot) and 10% (sustained) overhead budgets stated in Acceptance Criteria are deliberately generous. If the live numbers regress beyond those budgets, something in the instrumentation is more expensive than expected — investigate before shipping.

### Anti-DCE is not required for task-10 additions

Unlike task-8's `retained` reference (which could be DCE'd by the JIT because no subsequent code reads it), task-10's instrumentation reads end-of-window state via live syscalls (`process.cpuUsage(cpuStart)`, `process.memoryUsage().rss`, `numberOfDFGCompiles()`). These are side-effecting calls the JIT cannot DCE. The `highWaterRssBytes` accumulator is read after the loop when written into the result object, so the JIT sees a live use. No `void x` anti-DCE statements are required for task-10 — that mechanism was task-8-specific.

### Import path convention

Benchmark files at `benchmark/*.ts` import from `'../src/index.js'`. Scenario files at `benchmark/scenarios/*.ts` import from `'../../src/index.js'` and from `'../harness.js'`. `verbatimModuleSyntax` is on, so the `.js` extensions are required. Do not deviate.

## Verification Commands

```bash
bun run bench
bun test
bun run typecheck
bun run examples/particles.ts
cat .chief/milestone-2/_report/task-10/results.json | head -80
cat .chief/milestone-2/_report/task-10/benchmark.md | head -80
cat .chief/milestone-2/_report/task-10/bun-jsc-probe.txt
grep -rn "Proxy" src/
grep -rn "benchmark" tests/
grep -rn "from '.*src/struct\|from '.*src/slab" benchmark/
grep -rn "heapStats().objectCount" benchmark/
git diff --stat -- .chief/milestone-2/_report/task-7/ .chief/milestone-2/_report/task-9/
git diff --stat -- src/ tests/ examples/ package.json tsconfig.json CLAUDE.md .chief/_rules/ .chief/milestone-2/_contract/ .chief/milestone-2/_goal/ .chief/_template/
```

Expected results for each command are listed in the Acceptance Criteria above. The last two `git diff --stat` commands must print nothing (empty diff across the protected paths and the prior-task report paths).
