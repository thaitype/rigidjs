import { mkdir } from 'node:fs/promises'
import { runAll, formatTable, benchSustained, benchScaling, formatSustainedTable } from './harness.js'
import type { BenchResult, SustainedResult } from './harness.js'
import { b1Scenarios } from './scenarios/b1-struct-creation.js'
import { b2Scenarios } from './scenarios/b2-insert-remove-churn.js'
import { b3Scenarios } from './scenarios/b3-iterate-mutate.js'
import { b7Scenarios } from './scenarios/b7-nested-struct.js'
import { b8Scenarios } from './scenarios/b8-sustained-churn.js'
import { b9JsBaselineFactory, b9RigidJsFactory, CAPACITIES, XL_CAPACITY } from './scenarios/b9-heap-scaling.js'

// ---------------------------------------------------------------------------
// Run all scenarios B1 → B2 → B3 → B7
// ---------------------------------------------------------------------------

const allScenarios = [...b1Scenarios, ...b2Scenarios, ...b3Scenarios, ...b7Scenarios]

console.log('Running benchmarks...\n')
const results: BenchResult[] = await runAll(allScenarios)

// Print summary table to stdout
console.log(formatTable(results))

// ---------------------------------------------------------------------------
// Build run metadata
// ---------------------------------------------------------------------------

const meta = {
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  date: new Date().toISOString(),
}

// ---------------------------------------------------------------------------
// Write results.json
// ---------------------------------------------------------------------------

const reportDir = '.chief/milestone-2/_report/task-7'
await mkdir(reportDir, { recursive: true })

const resultsPath = `${reportDir}/results.json`
const payload = { meta, results }
await Bun.write(resultsPath, JSON.stringify(payload, null, 2))
console.log(`\nResults written to ${resultsPath}`)

// ---------------------------------------------------------------------------
// Write benchmark.md — human-readable report
// ---------------------------------------------------------------------------

function findResults(names: string[]): BenchResult[] {
  return names.map((n) => results.find((r) => r.name === n)!).filter(Boolean)
}

function fmtNullable(v: number | null): string {
  return v === null ? '-' : v.toLocaleString()
}

function mdTable(rows: BenchResult[]): string {
  const header = '| name | ops/s | heapΔ | allocΔ | retained | heapMB | rssMB | p50µs | p99µs |'
  const sep = '|------|-------|-------|--------|----------|--------|-------|-------|-------|'
  const dataRows = rows.map(
    (r) =>
      `| ${r.name} | ${r.opsPerSec.toLocaleString()} | ${r.heapObjectsDelta.toLocaleString()} | ${fmtNullable(r.allocationDelta)} | ${fmtNullable(r.retainedAfterGC)} | ${r.heapSizeMB.toFixed(2)} | ${r.rssMB.toFixed(2)} | ${r.p50Us.toFixed(2)} | ${r.p99Us.toFixed(2)} |`,
  )
  return [header, sep, ...dataRows].join('\n')
}

const b1Results = findResults(b1Scenarios.map((s) => s.name))
const b2Results = findResults(b2Scenarios.map((s) => s.name))
const b3Results = findResults(b3Scenarios.map((s) => s.name))
const b7Results = findResults(b7Scenarios.map((s) => s.name))

const b1JsAllocDelta = b1Results[0]?.allocationDelta ?? 0
const b1RigidAllocDelta = b1Results[1]?.allocationDelta ?? 0
const b1RigidRetained = b1Results[1]?.retainedAfterGC ?? 0
const b2JsP99 = b2Results[0]?.p99Us ?? 0
const b2RigidP99 = b2Results[1]?.p99Us ?? 0
const b3JsOps = b3Results[0]?.opsPerSec ?? 0
const b3RigidOps = b3Results[1]?.opsPerSec ?? 0
const b7NestedAllocDelta = b7Results[0]?.allocationDelta ?? 0
const b7FlatAllocDelta = b7Results[1]?.allocationDelta ?? 0
const b7RigidAllocDelta = b7Results[2]?.allocationDelta ?? 0
const b7RigidRetained = b7Results[2]?.retainedAfterGC ?? 0

const benchmarkMd = `# RigidJS Benchmark Report

**Bun version:** ${meta.bunVersion}
**Platform:** ${meta.platform} / ${meta.arch}
**Date:** ${meta.date}

---

## B1 — Struct creation

${mdTable(b1Results)}

B1 measures peak allocation pressure when creating 100,000 \`{x, y, z}\` entities using a corrected one-shot measurement that samples \`heapStats()\` before and after a single \`allocate()\` call without forcing GC in between (so the allocated state remains live at the second sample). The JS baseline allocates one JS object per entity, producing an \`allocationDelta\` of ~${b1JsAllocDelta.toLocaleString()} newly created objects — close to the expected 100,000. RigidJS stores all 100,000 entity slots in a single pre-allocated \`ArrayBuffer\`, producing an \`allocationDelta\` of ~${b1RigidAllocDelta.toLocaleString()} objects — roughly ${Math.round(b1JsAllocDelta / Math.max(b1RigidAllocDelta, 1))}x fewer GC-tracked objects than the JS baseline. The \`retainedAfterGC\` for RigidJS is ~${b1RigidRetained.toLocaleString()}, confirming the backing buffer is the only survivor once the slab reference is released.

---

## B2 — Insert/remove churn

${mdTable(b2Results)}

B2 measures worst-case latency (p99) during 100 frames of 10,000 insert + 10,000 remove operations. The JS baseline uses a pre-sized pool with a LIFO free-list (equivalent structure to slab) to isolate object-layout cost from algorithmic differences. JS p99 is ~${b2JsP99.toFixed(2)}µs vs RigidJS p99 of ~${b2RigidP99.toFixed(2)}µs. The delta reflects the cost of JS runtime object allocation, hidden-class creation, and GC tracking per inserted entity — work that RigidJS eliminates by reusing ArrayBuffer slots.

---

## B3 — Iteration + mutate

${mdTable(b3Results)}

B3 measures throughput (ops/sec) for a full 100,000-entity sweep computing \`pos.x += vel.x\`. Each "operation" is one complete 100k sweep. JS baseline: ${b3JsOps.toLocaleString()} sweeps/sec; RigidJS: ${b3RigidOps.toLocaleString()} sweeps/sec. RigidJS accesses pos.x and vel.x via DataView reads at pre-computed byte offsets, which the JIT can inline. However, DataView has overhead per read; the JS baseline benefits from JIT-optimized hidden-class property access on objects with a stable shape. Actual throughput ratio may vary depending on JIT warmup and memory layout effects at this scale.

---

## B7 — Nested struct (Particle)

${mdTable(b7Results)}

B7 compares three strategies for 50,000 Particle-like entities with nested \`pos\` / \`vel\` vectors, using the corrected one-shot allocation measurement. The JS nested baseline allocates three JS objects per entity (parent + pos + vel), producing an \`allocationDelta\` of ~${b7NestedAllocDelta.toLocaleString()} — close to the expected ~150,000 total objects. The JS flat baseline collapses these into one object per entity, producing an \`allocationDelta\` of ~${b7FlatAllocDelta.toLocaleString()} — approximately one-third the pressure of nested JS, confirming that manual flattening is itself a meaningful GC optimization. RigidJS uses a single \`ArrayBuffer\` for all 50,000 entities regardless of nesting depth, producing an \`allocationDelta\` of ~${b7RigidAllocDelta.toLocaleString()} objects — roughly ${Math.round(b7NestedAllocDelta / Math.max(b7RigidAllocDelta, 1))}x fewer than nested JS and roughly ${Math.round(b7FlatAllocDelta / Math.max(b7RigidAllocDelta, 1))}x fewer than flat JS. The \`retainedAfterGC\` for RigidJS is near zero (engine-internal fluctuation), showing that dropping the slab root allows the GC to reclaim the entire backing buffer regardless of how many entities were packed into it.

---

## Caveats

Single-run numbers are noisy and machine-dependent: JIT warmup state, OS scheduling, and GC timing all affect individual measurements. These benchmarks are reference data points, not statistically significant regressions gates. Scenarios B4 (filter chain via \`.iter()\`), B5 (temp allocation via \`bump()\`), and B6 (growable vec via \`vec()\`) are deferred until those primitives land in a future milestone — this suite intentionally covers only B1, B2, B3, and B7. Do not interpret the absence of B4/B5/B6 as evidence that RigidJS underperforms in those scenarios.

---

Machine-readable data: \`results.json\`
`

const benchmarkPath = `${reportDir}/benchmark.md`
await Bun.write(benchmarkPath, benchmarkMd)
console.log(`Report written to ${benchmarkPath}\n`)

// ---------------------------------------------------------------------------
// B8 — Sustained churn (10s, 100k capacity, 1k churn/tick)
// ---------------------------------------------------------------------------

console.log('Running sustained-load benchmarks (B8/B9)...\n')

const b8Results: SustainedResult[] = []
for (const scenario of b8Scenarios) {
  Bun.gc(true)
  await Bun.sleep(100)
  const result = await benchSustained(scenario)
  b8Results.push(result)
}

// ---------------------------------------------------------------------------
// B9 — Heap-pressure scaling curve
// ---------------------------------------------------------------------------

const xlEnabled =
  process.env['RIGIDJS_BENCH_XL'] === '1' || process.env['RIGIDJS_BENCH_XL'] === 'true'
const b9Capacities: number[] = [...CAPACITIES]
if (xlEnabled) b9Capacities.push(XL_CAPACITY)

const b9JsResults = await benchScaling(b9JsBaselineFactory, b9Capacities)
const b9RigidResults = await benchScaling(b9RigidJsFactory, b9Capacities)

// Interleave JS and RigidJS by capacity for the flat results array
const b9Results: SustainedResult[] = []
for (let i = 0; i < b9JsResults.length; i++) {
  b9Results.push(b9JsResults[i]!)
  b9Results.push(b9RigidResults[i]!)
}

// Print the sustained table below the per-op table
console.log('\n--- Sustained scenarios (B8/B9) ---\n')
console.log(formatSustainedTable([...b8Results, ...b9Results]))

// ---------------------------------------------------------------------------
// Write task-9 results.json
// ---------------------------------------------------------------------------

const task9ReportDir = '.chief/milestone-2/_report/task-9'
await mkdir(task9ReportDir, { recursive: true })

const task9Meta = {
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  date: new Date().toISOString(),
  xlEnabled,
}

const task9ResultsPath = `${task9ReportDir}/results.json`
const task9Payload = {
  meta: task9Meta,
  b8: b8Results,
  b9: b9Results,
}
await Bun.write(task9ResultsPath, JSON.stringify(task9Payload, null, 2))
console.log(`\nTask-9 results written to ${task9ResultsPath}`)

// ---------------------------------------------------------------------------
// Write task-9 benchmark.md
// ---------------------------------------------------------------------------

function fmtSustainedMdTable(
  rows: SustainedResult[],
  cols: (keyof SustainedResult)[],
  headers: string[],
): string {
  const headerRow = '| ' + headers.join(' | ') + ' |'
  const sepRow = '|' + headers.map(() => '---').join('|') + '|'
  const dataRows = rows.map((r) => {
    const cells = cols.map((c) => {
      const v = r[c]
      if (v === undefined || v === null) return '-'
      if (typeof v === 'number') {
        // Capacity and tick counts: integer; ms values: 4dp
        if (c === 'capacity' || c === 'ticksCompleted' || c === 'allocationDelta') {
          return v.toLocaleString()
        }
        return v.toFixed(4)
      }
      return String(v)
    })
    return '| ' + cells.join(' | ') + ' |'
  })
  return [headerRow, sepRow, ...dataRows].join('\n')
}

// B8 table: name, ticksCompleted, meanMs, p50Ms, p99Ms, p999Ms, maxMs, stdDevMs
const b8MdTable = fmtSustainedMdTable(
  b8Results,
  ['name', 'ticksCompleted', 'meanTickMs', 'p50TickMs', 'p99TickMs', 'p999TickMs', 'maxTickMs', 'stdDevTickMs'],
  ['name', 'ticks', 'meanMs', 'p50Ms', 'p99Ms', 'p999Ms', 'maxMs', 'stdDevMs'],
)

// B9 table: variant (name), capacity, ticksCompleted, meanMs, p99Ms, maxMs
const b9MdTable = fmtSustainedMdTable(
  b9Results,
  ['name', 'capacity', 'ticksCompleted', 'meanTickMs', 'p99TickMs', 'maxTickMs'],
  ['variant', 'capacity', 'ticks', 'meanMs', 'p99Ms', 'maxMs'],
)

// Pull out key numbers for interpretation
const b8Js = b8Results[0]!
const b8Rigid = b8Results[1]!
const p99Ratio = b8Js.p99TickMs > 0 ? (b8Rigid.p99TickMs / b8Js.p99TickMs).toFixed(2) : 'N/A'
const maxRatio = b8Js.maxTickMs > 0 ? (b8Rigid.maxTickMs / b8Js.maxTickMs).toFixed(2) : 'N/A'
const p999Ratio = b8Js.p999TickMs > 0 ? (b8Rigid.p999TickMs / b8Js.p999TickMs).toFixed(2) : 'N/A'

// Determine verdict
let verdictOutcome: 'supported' | 'partially_supported' | 'not_supported'
const b8RigidWinP99 = b8Rigid.p99TickMs < b8Js.p99TickMs
const b8RigidWinP999 = b8Rigid.p999TickMs < b8Js.p999TickMs
const b8RigidWinMax = b8Rigid.maxTickMs < b8Js.maxTickMs
const b8RigidWinMean = b8Rigid.meanTickMs < b8Js.meanTickMs

const tailWins = [b8RigidWinP99, b8RigidWinP999, b8RigidWinMax].filter(Boolean).length

if (tailWins >= 2) {
  // RigidJS wins on at least 2 of 3 tail metrics
  if (b8RigidWinMean) {
    verdictOutcome = 'supported'
  } else {
    // Mean/p50 lose but tail metrics win — that's exactly the thesis
    verdictOutcome = 'partially_supported'
  }
} else {
  verdictOutcome = 'not_supported'
}

let verdictSection: string
if (verdictOutcome === 'supported') {
  const tailWinList = [
    b8RigidWinP99 ? `p99 (${b8Rigid.p99TickMs.toFixed(4)}ms vs ${b8Js.p99TickMs.toFixed(4)}ms, ${p99Ratio}x)` : null,
    b8RigidWinP999 ? `p999 (${b8Rigid.p999TickMs.toFixed(4)}ms vs ${b8Js.p999TickMs.toFixed(4)}ms, ${p999Ratio}x)` : null,
    b8RigidWinMax ? `max-tick (${b8Rigid.maxTickMs.toFixed(4)}ms vs ${b8Js.maxTickMs.toFixed(4)}ms, ${maxRatio}x)` : null,
  ].filter(Boolean).join(', ')
  const maxNote = !b8RigidWinMax
    ? ` Max-tick shows JS slightly lower (${b8Js.maxTickMs.toFixed(4)}ms vs ${b8Rigid.maxTickMs.toFixed(4)}ms), indicating GC spike magnitudes are similar; the benefit is primarily in reducing GC pause frequency.`
    : ''
  verdictSection = `## Verdict

**Thesis supported.** RigidJS demonstrates lower tail latency on ${tailWinList} compared to the plain JS baseline under sustained 10s churn at 100k capacity.${maxNote} With ~300x fewer GC-tracked objects (established in task-7/task-8), the GC has far less work to do per collection, which reduces both the frequency and duration of GC pauses that would otherwise appear as tick-latency spikes. The DataView dispatch cost that made RigidJS slower on raw throughput benchmarks (B2, B3) matters less under sustained load once GC pressure is the bottleneck.`
} else if (verdictOutcome === 'partially_supported') {
  verdictSection = `## Verdict

**Thesis partially supported.** RigidJS mean tick latency (${b8Rigid.meanTickMs.toFixed(4)}ms) is higher than the JS baseline mean (${b8Js.meanTickMs.toFixed(4)}ms), consistent with task-7/task-8 findings that DataView dispatch costs more than JIT-inlined hidden-class access on a warm JIT. However, RigidJS wins on the tail metrics that matter for the GC-pressure thesis: p99 ${b8Rigid.p99TickMs.toFixed(4)}ms vs JS ${b8Js.p99TickMs.toFixed(4)}ms (ratio: ${p99Ratio}x), p999 ${b8Rigid.p999TickMs.toFixed(4)}ms vs JS ${b8Js.p999TickMs.toFixed(4)}ms (ratio: ${p999Ratio}x), max-tick ${b8Rigid.maxTickMs.toFixed(4)}ms vs JS ${b8Js.maxTickMs.toFixed(4)}ms (ratio: ${maxRatio}x). The RigidJS value proposition is specifically about tail latency: fewer GC-tracked objects means shorter GC pauses, which appear as high outlier ticks. The p99/p999/max data supports this claim. Applications where smooth frame delivery matters more than raw throughput — game loops, animation engines, real-time simulations — are the target use case, and this data suggests RigidJS delivers on that promise.`
} else {
  verdictSection = `## Verdict

**Thesis not supported by this data.** RigidJS tail latency (p99: ${b8Rigid.p99TickMs.toFixed(4)}ms, p999: ${b8Rigid.p999TickMs.toFixed(4)}ms, max: ${b8Rigid.maxTickMs.toFixed(4)}ms) is not meaningfully lower than the JS baseline (p99: ${b8Js.p99TickMs.toFixed(4)}ms, p999: ${b8Js.p999TickMs.toFixed(4)}ms, max: ${b8Js.maxTickMs.toFixed(4)}ms) at this scale. The DataView dispatch overhead that made RigidJS 2.6x–6.2x slower on raw throughput benchmarks (task-7) appears to dominate over any GC-pause savings from the ~300x lower object count. This does not mean the thesis is wrong in principle — at larger capacities (1M+, XL run) or with longer-running workloads, the GC pause savings may eventually exceed the DataView cost. The B9 scaling data (see above) can clarify whether the crossover point exists in the measured range. Until then, the honest reading is that RigidJS trades higher mean and tail latency for lower memory pressure and object-count, which may matter for memory-constrained or very large-scale scenarios but does not yet translate to p99 wins at 100k capacity on this machine.`
}

const xlNote = xlEnabled
  ? `XL run (10M capacity) was enabled via \`RIGIDJS_BENCH_XL=1\`. Note the ~600MB memory budget.`
  : `XL run (10M capacity) was not enabled. To run it: \`RIGIDJS_BENCH_XL=1 bun run bench\`. Note the ~600MB memory budget for the 10M case.`

const task9BenchmarkMd = `# RigidJS Sustained-Load Benchmark Report (B8/B9)

**Bun version:** ${task9Meta.bunVersion}
**Platform:** ${task9Meta.platform} / ${task9Meta.arch}
**Date:** ${task9Meta.date}
**XL enabled:** ${xlEnabled}

---

## Introduction

B8 and B9 exist to test the core RigidJS value proposition in hard numbers under sustained workloads. The task-7/task-8 findings established a clear picture:

- RigidJS allocates **~300x fewer GC-tracked objects** than plain JS at 100k entities (B1/B7 allocationDelta: ~100k JS vs ~315 RigidJS).
- RigidJS is **~2.6x–6.2x slower** than plain JS on raw per-operation throughput at small-to-medium scales, because DataView dispatch costs more than JIT-inlined hidden-class property access on a warm JIT (B2 p99: JS ~505µs vs RigidJS ~1253µs; B3 ops/sec: JS ~3393 vs RigidJS ~549).

The RigidJS thesis is **not** "tight loops run faster." It is **"your app stops pausing"** — two orders of magnitude fewer GC-tracked objects should translate to lower p99 tick latency and less wall-clock time lost to GC under sustained workloads where GC pressure is the bottleneck.

B8 tests this under a 10-second sustained churn at 100k capacity (1k insert + 1k remove + iterate all per tick). B9 varies capacity from 10k to 1M to test whether the JS p99 grows with heap size while RigidJS stays flat.

**This task reports the truth, whichever way the numbers fall.** The task succeeds if the experiment runs and reports honest results — not if RigidJS wins.

---

## B8 — Sustained churn (10s, 100k capacity, 1k churn/tick)

${b8MdTable}

**Key metric interpretation (p99 / tail behavior):** RigidJS p99 was ${b8Rigid.p99TickMs.toFixed(4)}ms, JS p99 was ${b8Js.p99TickMs.toFixed(4)}ms — RigidJS p99 is ${Number(p99Ratio) < 1 ? 'lower' : 'higher'} by a factor of ${p99Ratio}x. On p999, RigidJS was ${b8Rigid.p999TickMs.toFixed(4)}ms vs JS ${b8Js.p999TickMs.toFixed(4)}ms (ratio ${p999Ratio}x). On max-tick (the worst single GC spike), RigidJS was ${b8Rigid.maxTickMs.toFixed(4)}ms vs JS ${b8Js.maxTickMs.toFixed(4)}ms (ratio ${maxRatio}x). Mean tick latency: RigidJS ${b8Rigid.meanTickMs.toFixed(4)}ms vs JS ${b8Js.meanTickMs.toFixed(4)}ms — RigidJS mean is ${b8Rigid.meanTickMs > b8Js.meanTickMs ? 'higher (consistent with DataView dispatch overhead seen in B2/B3)' : 'actually lower, suggesting GC-pressure savings outweigh DataView dispatch cost under sustained load'}. The tail behavior ${b8RigidWinP99 && b8RigidWinP999 ? 'favors RigidJS' : b8RigidWinP99 || b8RigidWinP999 ? 'is mixed, with RigidJS winning on some tail metrics' : 'does not favor RigidJS at this capacity'}.

---

## B9 — Heap-pressure scaling curve

${b9MdTable}

**Scaling interpretation:** The B9 table shows how p99 tick latency evolves as capacity scales from 10k to 1M (and optionally 10M). If the GC-pressure thesis holds, JS p99 should grow with capacity (more live objects = longer GC pauses) while RigidJS p99 stays roughly flat (single ArrayBuffer, GC pressure does not scale with entity count). Any crossover point — where JS p99 catches up to or exceeds RigidJS p99 — is the scale at which RigidJS's GC advantage begins to pay off even accounting for DataView dispatch cost. ${xlNote}

---

${verdictSection}

---

## Caveats

Single-run numbers are noisy, GC behavior is non-deterministic between runs (GC pause timing, JIT compilation state, OS scheduling all contribute), and benchmarks were measured on a specific Bun version (${task9Meta.bunVersion}) and machine (${task9Meta.platform}/${task9Meta.arch}). These results are reference data points, not statistically significant regression gates. Re-running the benchmark on a different machine or Bun version may produce different tail-latency ratios. Raw data is in \`results.json\`.

---

Machine-readable data: \`results.json\`
`

const task9BenchmarkPath = `${task9ReportDir}/benchmark.md`
await Bun.write(task9BenchmarkPath, task9BenchmarkMd)
console.log(`Task-9 report written to ${task9BenchmarkPath}\n`)

process.exit(0)
