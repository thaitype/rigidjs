/**
 * benchmark/run-scenario.ts
 *
 * Subprocess entry point for per-process benchmark isolation.
 *
 * Each invocation runs one scenario group in a fresh OS process, eliminating
 * JIT contamination between scenario groups. With --variant, only the JS
 * baseline or RigidJS variants run, providing variant-level JIT isolation.
 *
 * Usage (spawned by benchmark/run.ts):
 *   bun run benchmark/run-scenario.ts \
 *     --file ./scenarios/b1-struct-creation.ts \
 *     --export b1Scenarios \
 *     --type oneshot \
 *     --variant js        # or --variant rigid
 *
 *   bun run benchmark/run-scenario.ts \
 *     --file ./scenarios/b8-sustained-churn.ts \
 *     --export b8Scenarios \
 *     --type sustained \
 *     --variant rigid
 *
 *   bun run benchmark/run-scenario.ts \
 *     --file ./scenarios/b9-heap-scaling.ts \
 *     --type scaling \
 *     --variant js
 *
 * --variant rules (applied to scenario name):
 *   js    → scenarios whose name does NOT contain "RigidJS" (case-sensitive)
 *   rigid → scenarios whose name contains "RigidJS"
 *   (omitted) → all scenarios (legacy / single-process mode)
 *
 * Stdout: a single JSON object with shape:
 *   { type: 'oneshot', results: BenchResult[] }
 *   { type: 'sustained', results: SustainedResult[] }
 *   { type: 'scaling', b9JsResults: SustainedResult[], b9RigidResults: SustainedResult[] }
 *
 * Errors are written to stderr; exit code is non-zero on failure.
 */

import {
  runAll,
  benchSustained,
  benchScaling,
} from './harness.js'
import type { BenchResult, SustainedResult, Scenario, SustainedScenario } from './harness.js'

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--') && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[i + 1]!
      i++
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

const filePath = args['file']
const exportName = args['export']
const type = args['type']
const variant = args['variant'] // 'js' | 'rigid' | undefined

if (!filePath || !type) {
  process.stderr.write('run-scenario: missing --file or --type argument\n')
  process.exit(1)
}

// Validate type
if (type !== 'oneshot' && type !== 'sustained' && type !== 'scaling') {
  process.stderr.write(`run-scenario: unknown --type "${type}". Expected oneshot | sustained | scaling\n`)
  process.exit(1)
}

// Validate variant (optional)
if (variant !== undefined && variant !== 'js' && variant !== 'rigid') {
  process.stderr.write(`run-scenario: unknown --variant "${variant}". Expected js | rigid\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Variant filter helpers
//
// Convention: scenario names containing "RigidJS" are RigidJS variants.
// All others (including "JS baseline", "JS flat", "JS nested") are JS variants.
// ---------------------------------------------------------------------------

function isRigidVariant(name: string): boolean {
  return name.includes('RigidJS') || name.startsWith('b9-rigid-')
}

function filterByVariant<T extends { name: string }>(scenarios: T[]): T[] {
  if (variant === undefined) return scenarios
  if (variant === 'js') return scenarios.filter((s) => !isRigidVariant(s.name))
  // variant === 'rigid'
  return scenarios.filter((s) => isRigidVariant(s.name))
}

// ---------------------------------------------------------------------------
// Dynamic import and dispatch
// ---------------------------------------------------------------------------

// Resolve path relative to this file's directory (benchmark/)
const resolvedPath = new URL(filePath, import.meta.url).href

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import boundary; type checked at each branch below
const mod = await import(resolvedPath) as Record<string, unknown>

if (type === 'oneshot') {
  // Expected export: Scenario[]
  if (!exportName) {
    process.stderr.write('run-scenario: --export is required for oneshot type\n')
    process.exit(1)
  }
  const rawScenarios = mod[exportName] as Scenario[] | undefined
  if (!Array.isArray(rawScenarios)) {
    process.stderr.write(`run-scenario: export "${exportName}" from "${filePath}" is not an array\n`)
    process.exit(1)
  }

  const scenarios = filterByVariant(rawScenarios)
  const results: BenchResult[] = scenarios.length > 0 ? await runAll(scenarios) : []
  process.stdout.write(JSON.stringify({ type: 'oneshot', results }, null, 2))

} else if (type === 'sustained') {
  // Expected export: SustainedScenario[]
  if (!exportName) {
    process.stderr.write('run-scenario: --export is required for sustained type\n')
    process.exit(1)
  }
  const rawScenarios = mod[exportName] as SustainedScenario[] | undefined
  if (!Array.isArray(rawScenarios)) {
    process.stderr.write(`run-scenario: export "${exportName}" from "${filePath}" is not an array\n`)
    process.exit(1)
  }

  const scenarios = filterByVariant(rawScenarios)
  const results: SustainedResult[] = []
  for (const scenario of scenarios) {
    Bun.gc(true)
    await Bun.sleep(100)
    const result = await benchSustained(scenario)
    results.push(result)
  }
  process.stdout.write(JSON.stringify({ type: 'sustained', results }, null, 2))

} else {
  // type === 'scaling'
  // Expected exports: b9JsBaselineFactory, b9RigidJsFactory, CAPACITIES, XL_CAPACITY
  const xlEnabled =
    process.env['RIGIDJS_BENCH_XL'] === '1' || process.env['RIGIDJS_BENCH_XL'] === 'true'

  const b9JsBaselineFactory = mod['b9JsBaselineFactory'] as ((cap: number) => SustainedScenario) | undefined
  const b9RigidJsFactory = mod['b9RigidJsFactory'] as ((cap: number) => SustainedScenario) | undefined
  const CAPACITIES = mod['CAPACITIES'] as readonly number[] | undefined
  const XL_CAPACITY = mod['XL_CAPACITY'] as number | undefined

  if (typeof b9JsBaselineFactory !== 'function' || typeof b9RigidJsFactory !== 'function') {
    process.stderr.write(`run-scenario: missing b9JsBaselineFactory or b9RigidJsFactory in "${filePath}"\n`)
    process.exit(1)
  }
  if (!Array.isArray(CAPACITIES) || typeof XL_CAPACITY !== 'number') {
    process.stderr.write(`run-scenario: missing CAPACITIES or XL_CAPACITY export in "${filePath}"\n`)
    process.exit(1)
  }

  const b9Capacities: number[] = [...CAPACITIES]
  if (xlEnabled) b9Capacities.push(XL_CAPACITY)

  if (variant === 'js') {
    // Run only the JS baseline factory
    const b9JsResults = await benchScaling(b9JsBaselineFactory, b9Capacities)
    process.stdout.write(JSON.stringify({ type: 'scaling', b9JsResults, b9RigidResults: [] }, null, 2))
  } else if (variant === 'rigid') {
    // Run only the RigidJS factory
    const b9RigidResults = await benchScaling(b9RigidJsFactory, b9Capacities)
    process.stdout.write(JSON.stringify({ type: 'scaling', b9JsResults: [], b9RigidResults }, null, 2))
  } else {
    // No variant filter — run both (legacy / single-process mode)
    const b9JsResults = await benchScaling(b9JsBaselineFactory, b9Capacities)
    const b9RigidResults = await benchScaling(b9RigidJsFactory, b9Capacities)
    process.stdout.write(JSON.stringify({ type: 'scaling', b9JsResults, b9RigidResults }, null, 2))
  }
}
