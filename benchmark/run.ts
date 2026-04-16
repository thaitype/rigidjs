/**
 * benchmark/run.ts
 *
 * Simple sequential benchmark runner with per-process JIT isolation.
 *
 * Usage:
 *   bun run bench              — run all scenarios
 *   bun run bench -s B1-slab   — run a single scenario by name
 *
 * Each scenario group runs two sequential OS processes — one for the JS
 * baseline variant and one for the RigidJS variant — so JIT optimizations
 * from the baseline cannot leak into the RigidJS measurement.
 * All spawns are sequential — no parallel processes compete for CPU or memory.
 */

import { mkdir } from 'node:fs/promises'
import { formatTable, formatSustainedTable, jitCountersAvailable } from './harness.js'
import type { BenchResult, SustainedResult } from './harness.js'

// ---------------------------------------------------------------------------
// Multi-run statistics helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

function minOf(values: number[]): number {
  return values.reduce((acc, v) => Math.min(acc, v), Infinity)
}

function maxOf(values: number[]): number {
  return values.reduce((acc, v) => Math.max(acc, v), -Infinity)
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const squaredDiffs = values.map(v => (v - mean) ** 2)
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length)
}

interface OneshotMultiStats {
  name: string
  medianOpsPerSec: number
  minOpsPerSec: number
  maxOpsPerSec: number
  stddevOpsPerSec: number
  runs: number
  rawRuns: BenchResult[]
}

interface SustainedMultiStats {
  name: string
  capacity?: number
  medianTicks: number
  minTicks: number
  maxTicks: number
  stddevTicks: number
  medianP99Ms: number
  minP99Ms: number
  maxP99Ms: number
  stddevP99Ms: number
  runs: number
  rawRuns: SustainedResult[]
}

function aggregateOneshotRuns(allRuns: BenchResult[][]): OneshotMultiStats[] {
  // allRuns[runIndex] = BenchResult[] for one run
  // Pivot to per-name arrays
  const byName = new Map<string, BenchResult[]>()
  for (const runResults of allRuns) {
    for (const r of runResults) {
      if (!byName.has(r.name)) byName.set(r.name, [])
      byName.get(r.name)!.push(r)
    }
  }
  const stats: OneshotMultiStats[] = []
  for (const [name, results] of byName) {
    const ops = results.map((r) => r.opsPerSec)
    stats.push({
      name,
      medianOpsPerSec: Math.round(median(ops)),
      minOpsPerSec: minOf(ops),
      maxOpsPerSec: maxOf(ops),
      stddevOpsPerSec: Math.round(stddev(ops)),
      runs: results.length,
      rawRuns: results,
    })
  }
  return stats
}

function aggregateSustainedRuns(allRuns: SustainedResult[][]): SustainedMultiStats[] {
  const byName = new Map<string, SustainedResult[]>()
  for (const runResults of allRuns) {
    for (const r of runResults) {
      if (!byName.has(r.name)) byName.set(r.name, [])
      byName.get(r.name)!.push(r)
    }
  }
  const stats: SustainedMultiStats[] = []
  for (const [name, results] of byName) {
    const ticks = results.map((r) => r.ticksCompleted)
    const p99s = results.map((r) => r.p99TickMs)
    stats.push({
      name,
      capacity: results[0]?.capacity,
      medianTicks: Math.round(median(ticks)),
      minTicks: minOf(ticks),
      maxTicks: maxOf(ticks),
      stddevTicks: Math.round(stddev(ticks)),
      medianP99Ms: +median(p99s).toFixed(3),
      minP99Ms: minOf(p99s),
      maxP99Ms: maxOf(p99s),
      stddevP99Ms: +stddev(p99s).toFixed(3),
      runs: results.length,
      rawRuns: results,
    })
  }
  return stats
}

function formatMultiOneshotTable(stats: OneshotMultiStats[]): string {
  const COL_NAME = 36
  const COL_MEDIAN = 14
  const COL_MIN = 12
  const COL_MAX = 12
  const COL_STDDEV = 12
  const COL_RUNS = 6

  function pad(s: string, n: number, right = false): string {
    return right ? s.padStart(n) : s.padEnd(n)
  }

  const header = [
    pad('name', COL_NAME),
    pad('median ops/s', COL_MEDIAN, true),
    pad('min ops/s', COL_MIN, true),
    pad('max ops/s', COL_MAX, true),
    pad('stddev', COL_STDDEV, true),
    pad('runs', COL_RUNS, true),
  ].join('  ')

  const sep = '-'.repeat(header.length)

  const rows = stats.map((s) =>
    [
      pad(s.name, COL_NAME),
      pad(s.medianOpsPerSec.toLocaleString(), COL_MEDIAN, true),
      pad(s.minOpsPerSec.toLocaleString(), COL_MIN, true),
      pad(s.maxOpsPerSec.toLocaleString(), COL_MAX, true),
      pad(s.stddevOpsPerSec.toLocaleString(), COL_STDDEV, true),
      pad(String(s.runs), COL_RUNS, true),
    ].join('  '),
  )

  return [header, sep, ...rows].join('\n')
}

function formatMultiSustainedTable(stats: SustainedMultiStats[]): string {
  const COL_NAME = 36
  const COL_MED_TICKS = 14
  const COL_MIN_TICKS = 12
  const COL_MAX_TICKS = 12
  const COL_STDDEV_TICKS = 14
  const COL_MED_P99 = 12
  const COL_STDDEV_P99 = 12
  const COL_RUNS = 6

  function pad(s: string, n: number, right = false): string {
    return right ? s.padStart(n) : s.padEnd(n)
  }

  const header = [
    pad('name', COL_NAME),
    pad('median ticks', COL_MED_TICKS, true),
    pad('min ticks', COL_MIN_TICKS, true),
    pad('max ticks', COL_MAX_TICKS, true),
    pad('stddev ticks', COL_STDDEV_TICKS, true),
    pad('med p99ms', COL_MED_P99, true),
    pad('stddev p99ms', COL_STDDEV_P99, true),
    pad('runs', COL_RUNS, true),
  ].join('  ')

  const sep = '-'.repeat(header.length)

  const rows = stats.map((s) =>
    [
      pad(s.name, COL_NAME),
      pad(s.medianTicks.toLocaleString(), COL_MED_TICKS, true),
      pad(s.minTicks.toLocaleString(), COL_MIN_TICKS, true),
      pad(s.maxTicks.toLocaleString(), COL_MAX_TICKS, true),
      pad(s.stddevTicks.toLocaleString(), COL_STDDEV_TICKS, true),
      pad(s.medianP99Ms.toFixed(3), COL_MED_P99, true),
      pad(s.stddevP99Ms.toFixed(3), COL_STDDEV_P99, true),
      pad(String(s.runs), COL_RUNS, true),
    ].join('  '),
  )

  return [header, sep, ...rows].join('\n')
}

// ---------------------------------------------------------------------------
// CLI parsing — supports -s <name> and -n <count>
// ---------------------------------------------------------------------------

function parseCli(argv: string[]): { singleScenario: string | null; runs: number } {
  let singleScenario: string | null = null
  let runs = 1
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-s' && i + 1 < argv.length) {
      singleScenario = argv[i + 1]!
      i++
    } else if (argv[i] === '-n' && i + 1 < argv.length) {
      const n = parseInt(argv[i + 1]!, 10)
      if (isNaN(n) || n < 1) {
        console.error(`Invalid -n value: "${argv[i + 1]}". Must be a positive integer.`)
        process.exit(1)
      }
      runs = n
      i++
    }
  }
  return { singleScenario, runs }
}

const { singleScenario, runs } = parseCli(process.argv.slice(2))

// ---------------------------------------------------------------------------
// Scenario registry
//
// Each entry describes one scenario group and how to run it.
// name: human-readable identifier — used for -s filtering
// ---------------------------------------------------------------------------

type OneshotEntry = {
  kind: 'oneshot'
  name: string
  file: string
  export: string
}

type SustainedEntry = {
  kind: 'sustained'
  name: string
  file: string
  export: string
}

type ScalingEntry = {
  kind: 'scaling'
  name: string
  file: string
}

type ScenarioEntry = OneshotEntry | SustainedEntry | ScalingEntry

const SCENARIOS: ScenarioEntry[] = [
  // One-shot scenarios
  { kind: 'oneshot', name: 'B1-slab',           file: './scenarios/b1-struct-creation.ts',    export: 'b1Scenarios'           },
  { kind: 'oneshot', name: 'B2-slab',           file: './scenarios/b2-insert-remove-churn.ts', export: 'b2Scenarios'          },
  { kind: 'oneshot', name: 'B3-iterate',        file: './scenarios/b3-iterate-mutate.ts',      export: 'b3Scenarios'           },
  { kind: 'oneshot', name: 'B3-column',         file: './scenarios/b3-column.ts',              export: 'b3ColumnScenarios'     },
  { kind: 'oneshot', name: 'B7-nested',         file: './scenarios/b7-nested-struct.ts',       export: 'b7Scenarios'           },
  { kind: 'oneshot', name: 'B1-vec',            file: './scenarios/b1-vec-creation.ts',        export: 'b1VecScenarios'        },
  { kind: 'oneshot', name: 'B2-vec',            file: './scenarios/b2-vec-churn.ts',           export: 'b2VecScenarios'        },
  { kind: 'oneshot', name: 'B3-vec-handle',     file: './scenarios/b3-vec-handle.ts',          export: 'b3VecHandleScenarios'  },
  { kind: 'oneshot', name: 'B3-vec-column',     file: './scenarios/b3-vec-column.ts',          export: 'b3VecColumnScenarios'  },
  { kind: 'oneshot', name: 'B3-partial',        file: './scenarios/b3-partial.ts',             export: 'b3PartialScenarios'    },
  { kind: 'oneshot', name: 'B3-vec-get',        file: './scenarios/b3-vec-get.ts',             export: 'b3VecGetScenarios'     },
  { kind: 'oneshot', name: 'B3-vec-forEach',    file: './scenarios/b3-vec-forEach.ts',         export: 'b3VecForEachScenarios' },
  { kind: 'oneshot', name: 'B3-slab-forEach',   file: './scenarios/b3-slab-forEach.ts',        export: 'b3SlabForEachScenarios'},
  { kind: 'oneshot', name: 'B1-small-scale',    file: './scenarios/b1-small-scale.ts',         export: 'b1SmallScenarios'      },
  { kind: 'oneshot', name: 'B2-small-scale',    file: './scenarios/b2-small-scale.ts',         export: 'b2SmallScenarios'      },
  { kind: 'oneshot', name: 'B3-small-scale',    file: './scenarios/b3-small-scale.ts',         export: 'b3SmallScenarios'      },
  { kind: 'oneshot', name: 'B1-hybrid',         file: './scenarios/b1-hybrid-small.ts',        export: 'b1HybridScenarios'     },
  { kind: 'oneshot', name: 'B2-hybrid',         file: './scenarios/b2-hybrid-small.ts',        export: 'b2HybridScenarios'     },
  { kind: 'oneshot', name: 'B10-graduation',    file: './scenarios/b10-graduation.ts',         export: 'b10Scenarios'          },
  // Sustained / scaling
  { kind: 'sustained', name: 'B8-sustained',    file: './scenarios/b8-sustained-churn.ts',     export: 'b8Scenarios'           },
  { kind: 'scaling',   name: 'B9-scaling',      file: './scenarios/b9-heap-scaling.ts'                                         },
  { kind: 'sustained', name: 'B8-vec',          file: './scenarios/b8-vec-sustained.ts',        export: 'b8VecScenarios'        },
  { kind: 'scaling',   name: 'B9-vec',          file: './scenarios/b9-vec-scaling.ts'                                           },
]

// Apply -s filter
const selectedScenarios = singleScenario
  ? SCENARIOS.filter((s) => s.name === singleScenario)
  : SCENARIOS

if (selectedScenarios.length === 0) {
  const names = SCENARIOS.map((s) => s.name).join(', ')
  console.error(`No scenario named "${singleScenario}". Available: ${names}`)
  process.exit(1)
}

const multiRun = runs > 1

// ---------------------------------------------------------------------------
// Subprocess spawner
// ---------------------------------------------------------------------------

interface OneshotSubprocessResult { type: 'oneshot'; results: BenchResult[] }
interface SustainedSubprocessResult { type: 'sustained'; results: SustainedResult[] }
interface ScalingSubprocessResult { type: 'scaling'; b9JsResults: SustainedResult[]; b9RigidResults: SustainedResult[] }

async function spawnScenario(opts: {
  file: string
  export?: string
  type: 'oneshot' | 'sustained' | 'scaling'
  name: string
  variant?: 'js' | 'rigid'
}): Promise<unknown> {
  const args = [
    '--smol',
    'benchmark/run-scenario.ts',
    '--file', opts.file,
    '--type', opts.type,
  ]
  if (opts.export) args.push('--export', opts.export)
  if (opts.variant) args.push('--variant', opts.variant)

  const variantLabel = opts.variant ? ` [${opts.variant}]` : ''
  console.log(`  Running: ${opts.name}${variantLabel}`)

  const proc = Bun.spawn(['bun', ...args], {
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (stderr.trim()) {
    process.stderr.write(`[${opts.name}] ${stderr}\n`)
  }

  if (exitCode !== 0) {
    throw new Error(`Subprocess "${opts.name}" exited with code ${exitCode}:\n${stderr.trim() || '(no stderr)'}`)
  }

  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`Subprocess "${opts.name}" produced invalid JSON:\n${stdout.slice(0, 500)}`)
  }
}

// ---------------------------------------------------------------------------
// Result decoders
// ---------------------------------------------------------------------------

function asOneshot(v: unknown, name: string): OneshotSubprocessResult {
  const r = v as OneshotSubprocessResult
  if (r?.type !== 'oneshot' || !Array.isArray(r.results)) {
    throw new Error(`Expected oneshot result from "${name}", got: ${JSON.stringify(v)?.slice(0, 200)}`)
  }
  return r
}

function asSustained(v: unknown, name: string): SustainedSubprocessResult {
  const r = v as SustainedSubprocessResult
  if (r?.type !== 'sustained' || !Array.isArray(r.results)) {
    throw new Error(`Expected sustained result from "${name}", got: ${JSON.stringify(v)?.slice(0, 200)}`)
  }
  return r
}

function asScaling(v: unknown, name: string): ScalingSubprocessResult {
  const r = v as ScalingSubprocessResult
  if (r?.type !== 'scaling' || !Array.isArray(r.b9JsResults) || !Array.isArray(r.b9RigidResults)) {
    throw new Error(`Expected scaling result from "${name}", got: ${JSON.stringify(v)?.slice(0, 200)}`)
  }
  return r
}

// ---------------------------------------------------------------------------
// Write-split helpers (scalar results.json + bulk raw-timeseries.json)
// ---------------------------------------------------------------------------

function stripHeapTimeSeries(r: SustainedResult): Omit<SustainedResult, 'heapTimeSeries'> {
  const { heapTimeSeries: _, ...rest } = r
  return rest
}

async function writeReportSplit(dir: string, payload: object, timeseries: object): Promise<void> {
  await Bun.write(`${dir}/results.json`, JSON.stringify(payload, null, 2))
  await Bun.write(`${dir}/raw-timeseries.json`, JSON.stringify(timeseries, null, 2))
}

// ---------------------------------------------------------------------------
// Main run loop
// ---------------------------------------------------------------------------

console.log(`Running benchmarks${singleScenario ? ` (scenario: ${singleScenario})` : ' (all scenarios)'}${multiRun ? ` x${runs}` : ''} — sequential per-process isolation\n`)

// Single-run collections (used when runs === 1)
const oneshotResults: BenchResult[] = []
const sustainedResults: SustainedResult[] = []
const scalingB9: { jsResults: SustainedResult[]; rigidResults: SustainedResult[] } = { jsResults: [], rigidResults: [] }

// Multi-run collections (used when runs > 1)
// Each element is the full results array from one run
const oneshotRunsAccum: BenchResult[][] = []
const sustainedRunsAccum: SustainedResult[][] = []
const scalingB9RunsAccum: { jsResults: SustainedResult[]; rigidResults: SustainedResult[] }[] = []

for (let runIdx = 0; runIdx < runs; runIdx++) {
  if (multiRun) {
    console.log(`\n--- Run ${runIdx + 1}/${runs} ---`)
  }

  const runOneshotResults: BenchResult[] = []
  const runSustainedResults: SustainedResult[] = []
  const runScalingB9: { jsResults: SustainedResult[]; rigidResults: SustainedResult[] } = { jsResults: [], rigidResults: [] }

  for (const scenario of selectedScenarios) {
    if (scenario.kind === 'oneshot') {
      // JS baseline subprocess — runs only scenarios without "RigidJS" in the name
      const rawJs = await spawnScenario({ file: scenario.file, export: scenario.export, type: 'oneshot', name: scenario.name, variant: 'js' })
      runOneshotResults.push(...asOneshot(rawJs, scenario.name).results)

      // RigidJS subprocess — runs only scenarios with "RigidJS" in the name
      const rawRigid = await spawnScenario({ file: scenario.file, export: scenario.export, type: 'oneshot', name: scenario.name, variant: 'rigid' })
      runOneshotResults.push(...asOneshot(rawRigid, scenario.name).results)

    } else if (scenario.kind === 'sustained') {
      // JS baseline subprocess
      const rawJs = await spawnScenario({ file: scenario.file, export: scenario.export, type: 'sustained', name: scenario.name, variant: 'js' })
      runSustainedResults.push(...asSustained(rawJs, scenario.name).results)

      // RigidJS subprocess
      const rawRigid = await spawnScenario({ file: scenario.file, export: scenario.export, type: 'sustained', name: scenario.name, variant: 'rigid' })
      runSustainedResults.push(...asSustained(rawRigid, scenario.name).results)

    } else {
      // scaling: JS baseline subprocess then RigidJS subprocess
      const rawJs = await spawnScenario({ file: scenario.file, type: 'scaling', name: scenario.name, variant: 'js' })
      const { b9JsResults } = asScaling(rawJs, scenario.name)
      runScalingB9.jsResults.push(...b9JsResults)

      const rawRigid = await spawnScenario({ file: scenario.file, type: 'scaling', name: scenario.name, variant: 'rigid' })
      const { b9RigidResults } = asScaling(rawRigid, scenario.name)
      runScalingB9.rigidResults.push(...b9RigidResults)
    }
  }

  if (multiRun) {
    oneshotRunsAccum.push(runOneshotResults)
    sustainedRunsAccum.push(runSustainedResults)
    scalingB9RunsAccum.push(runScalingB9)
  } else {
    oneshotResults.push(...runOneshotResults)
    sustainedResults.push(...runSustainedResults)
    scalingB9.jsResults.push(...runScalingB9.jsResults)
    scalingB9.rigidResults.push(...runScalingB9.rigidResults)
  }
}

// For multi-run: collapse all run accumulators into flat arrays used by report
const allOneshotForReport: BenchResult[] = multiRun
  ? oneshotRunsAccum.flat()
  : oneshotResults
const allSustainedForReport: SustainedResult[] = multiRun
  ? sustainedRunsAccum.flat()
  : sustainedResults
const allScalingB9ForReport = multiRun
  ? scalingB9RunsAccum.reduce(
      (acc, r) => {
        acc.jsResults.push(...r.jsResults)
        acc.rigidResults.push(...r.rigidResults)
        return acc
      },
      { jsResults: [] as SustainedResult[], rigidResults: [] as SustainedResult[] },
    )
  : scalingB9

// Interleave B9 JS/RigidJS results by index for table display (single-run)
const b9Interleaved: SustainedResult[] = []
const b9Source = multiRun ? allScalingB9ForReport : scalingB9
for (let i = 0; i < b9Source.jsResults.length; i++) {
  b9Interleaved.push(b9Source.jsResults[i]!)
  if (b9Source.rigidResults[i]) b9Interleaved.push(b9Source.rigidResults[i]!)
}

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

if (multiRun) {
  // Multi-run: aggregate and show median/min/max tables
  const oneshotStats = aggregateOneshotRuns(oneshotRunsAccum)
  if (oneshotStats.length > 0) {
    console.log('\n--- One-shot scenarios (multi-run summary) ---\n')
    console.log(formatMultiOneshotTable(oneshotStats))
  }

  // Sustained multi-run: combine all sustained + scaling into one aggregation
  const allSustainedRuns: SustainedResult[][] = []
  for (let i = 0; i < runs; i++) {
    const sustained = sustainedRunsAccum[i] ?? []
    const runScaling = scalingB9RunsAccum[i]
    const scalingAll: SustainedResult[] = runScaling
      ? [...runScaling.jsResults, ...runScaling.rigidResults]
      : []
    allSustainedRuns.push([...sustained, ...scalingAll])
  }
  const sustainedStats = aggregateSustainedRuns(allSustainedRuns)
  if (sustainedStats.length > 0) {
    console.log('\n--- Sustained / scaling scenarios (multi-run summary) ---\n')
    console.log(formatMultiSustainedTable(sustainedStats))
  }
} else {
  // Single-run: original output format
  if (oneshotResults.length > 0) {
    console.log('\n--- One-shot scenarios ---\n')
    console.log(formatTable(oneshotResults))
  }

  if (sustainedResults.length > 0 || b9Interleaved.length > 0) {
    console.log('\n--- Sustained / scaling scenarios ---\n')
    console.log(formatSustainedTable([...sustainedResults, ...b9Interleaved]))
  }
}

// ---------------------------------------------------------------------------
// Write report to milestone-5 report directory
// ---------------------------------------------------------------------------

const meta = {
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  date: new Date().toISOString(),
  xlEnabled: process.env['RIGIDJS_BENCH_XL'] === '1' || process.env['RIGIDJS_BENCH_XL'] === 'true',
  jitCountersAvailable,
  scenario: singleScenario ?? 'all',
  runs,
}

const reportDir = '.chief/milestone-5/_report/bench'
await mkdir(reportDir, { recursive: true })

const b9ScalarsJs = allScalingB9ForReport.jsResults.map(stripHeapTimeSeries)
const b9ScalarsRigid = allScalingB9ForReport.rigidResults.map(stripHeapTimeSeries)
const b9TimeseriesJs = allScalingB9ForReport.jsResults.map((r) => ({ name: r.name, heapTimeSeries: r.heapTimeSeries }))
const b9TimeseriesRigid = allScalingB9ForReport.rigidResults.map((r) => ({ name: r.name, heapTimeSeries: r.heapTimeSeries }))
const b8Scalars = allSustainedForReport.map(stripHeapTimeSeries)
const b8Timeseries = allSustainedForReport.map((r) => ({ name: r.name, heapTimeSeries: r.heapTimeSeries }))

let payload: object

if (multiRun) {
  // Multi-run: store aggregated stats + raw runs
  const oneshotStats = aggregateOneshotRuns(oneshotRunsAccum)
  const allSustainedRunsForReport: SustainedResult[][] = []
  for (let i = 0; i < runs; i++) {
    const sustained = sustainedRunsAccum[i] ?? []
    const runScaling = scalingB9RunsAccum[i]
    const scalingAll: SustainedResult[] = runScaling
      ? [...runScaling.jsResults, ...runScaling.rigidResults]
      : []
    allSustainedRunsForReport.push([...sustained, ...scalingAll])
  }
  const sustainedStats = aggregateSustainedRuns(allSustainedRunsForReport)

  const oneshotStatsForReport = oneshotStats.map(({ rawRuns, ...rest }) => ({
    ...rest,
    rawRuns,
  }))

  const sustainedStatsForReport = sustainedStats.map(({ rawRuns, ...rest }) => ({
    ...rest,
    rawRuns: rawRuns.map(stripHeapTimeSeries),
  }))

  payload = {
    meta,
    oneShot: oneshotStatsForReport,
    sustained: {
      b8: b8Scalars,
      b9Js: b9ScalarsJs,
      b9Rigid: b9ScalarsRigid,
      sustainedStats: sustainedStatsForReport,
    },
  }
} else {
  payload = {
    meta,
    oneShot: allOneshotForReport,
    sustained: { b8: b8Scalars, b9Js: b9ScalarsJs, b9Rigid: b9ScalarsRigid },
  }
}

const timeseries = {
  meta: { date: meta.date, description: 'heapTimeSeries arrays stripped from results.json' },
  b8: b8Timeseries,
  b9Js: b9TimeseriesJs,
  b9Rigid: b9TimeseriesRigid,
}

await writeReportSplit(reportDir, payload, timeseries)
console.log(`\nResults written to ${reportDir}/results.json`)
