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
// CLI parsing — only -s <name> is supported
// ---------------------------------------------------------------------------

function parseCli(argv: string[]): { singleScenario: string | null } {
  let singleScenario: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-s' && i + 1 < argv.length) {
      singleScenario = argv[i + 1]!
      i++
    }
  }
  return { singleScenario }
}

const { singleScenario } = parseCli(process.argv.slice(2))

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
  // Sustained / scaling
  { kind: 'sustained', name: 'B8-sustained',    file: './scenarios/b8-sustained-churn.ts',     export: 'b8Scenarios'           },
  { kind: 'scaling',   name: 'B9-scaling',      file: './scenarios/b9-heap-scaling.ts'                                         },
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

console.log(`Running benchmarks${singleScenario ? ` (scenario: ${singleScenario})` : ' (all scenarios)'} — sequential per-process isolation\n`)

const oneshotResults: BenchResult[] = []
const sustainedResults: SustainedResult[] = []
const scalingB9: { jsResults: SustainedResult[]; rigidResults: SustainedResult[] } = { jsResults: [], rigidResults: [] }

for (const scenario of selectedScenarios) {
  if (scenario.kind === 'oneshot') {
    // JS baseline subprocess — runs only scenarios without "RigidJS" in the name
    const rawJs = await spawnScenario({ file: scenario.file, export: scenario.export, type: 'oneshot', name: scenario.name, variant: 'js' })
    oneshotResults.push(...asOneshot(rawJs, scenario.name).results)

    // RigidJS subprocess — runs only scenarios with "RigidJS" in the name
    const rawRigid = await spawnScenario({ file: scenario.file, export: scenario.export, type: 'oneshot', name: scenario.name, variant: 'rigid' })
    oneshotResults.push(...asOneshot(rawRigid, scenario.name).results)

  } else if (scenario.kind === 'sustained') {
    // JS baseline subprocess
    const rawJs = await spawnScenario({ file: scenario.file, export: scenario.export, type: 'sustained', name: scenario.name, variant: 'js' })
    sustainedResults.push(...asSustained(rawJs, scenario.name).results)

    // RigidJS subprocess
    const rawRigid = await spawnScenario({ file: scenario.file, export: scenario.export, type: 'sustained', name: scenario.name, variant: 'rigid' })
    sustainedResults.push(...asSustained(rawRigid, scenario.name).results)

  } else {
    // scaling: JS baseline subprocess then RigidJS subprocess
    const rawJs = await spawnScenario({ file: scenario.file, type: 'scaling', name: scenario.name, variant: 'js' })
    const { b9JsResults } = asScaling(rawJs, scenario.name)
    scalingB9.jsResults.push(...b9JsResults)

    const rawRigid = await spawnScenario({ file: scenario.file, type: 'scaling', name: scenario.name, variant: 'rigid' })
    const { b9RigidResults } = asScaling(rawRigid, scenario.name)
    scalingB9.rigidResults.push(...b9RigidResults)
  }
}

// Interleave B9 JS/RigidJS results by index for table display
const b9Interleaved: SustainedResult[] = []
for (let i = 0; i < scalingB9.jsResults.length; i++) {
  b9Interleaved.push(scalingB9.jsResults[i]!)
  if (scalingB9.rigidResults[i]) b9Interleaved.push(scalingB9.rigidResults[i]!)
}

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

if (oneshotResults.length > 0) {
  console.log('\n--- One-shot scenarios ---\n')
  console.log(formatTable(oneshotResults))
}

if (sustainedResults.length > 0 || b9Interleaved.length > 0) {
  console.log('\n--- Sustained / scaling scenarios ---\n')
  console.log(formatSustainedTable([...sustainedResults, ...b9Interleaved]))
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
}

const reportDir = '.chief/milestone-5/_report/bench'
await mkdir(reportDir, { recursive: true })

const b9ScalarsJs = scalingB9.jsResults.map(stripHeapTimeSeries)
const b9ScalarsRigid = scalingB9.rigidResults.map(stripHeapTimeSeries)
const b9TimeseriesJs = scalingB9.jsResults.map((r) => ({ name: r.name, heapTimeSeries: r.heapTimeSeries }))
const b9TimeseriesRigid = scalingB9.rigidResults.map((r) => ({ name: r.name, heapTimeSeries: r.heapTimeSeries }))
const b8Scalars = sustainedResults.map(stripHeapTimeSeries)
const b8Timeseries = sustainedResults.map((r) => ({ name: r.name, heapTimeSeries: r.heapTimeSeries }))

const payload = {
  meta,
  oneShot: oneshotResults,
  sustained: { b8: b8Scalars, b9Js: b9ScalarsJs, b9Rigid: b9ScalarsRigid },
}

const timeseries = {
  meta: { date: meta.date, description: 'heapTimeSeries arrays stripped from results.json' },
  b8: b8Timeseries,
  b9Js: b9TimeseriesJs,
  b9Rigid: b9TimeseriesRigid,
}

await writeReportSplit(reportDir, payload, timeseries)
console.log(`\nResults written to ${reportDir}/results.json`)
