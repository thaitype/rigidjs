/**
 * benchmark/probe-jsc.ts
 *
 * Two-phase probe of the `bun:jsc` module surface for the current Bun runtime.
 *
 * Phase A — zero-arg counters: called with no arguments; return a number
 *   directly. These are process-global signals (e.g. totalCompileTime, heapSize).
 *
 * Phase B — function-argument counters: signature `(fn: Function) => number`.
 *   Probed by warming a throwaway function past the DFG compilation threshold and
 *   then calling each candidate counter with that function as the argument.
 *   Example: numberOfDFGCompiles(probeHot) → 1 on Bun 1.3.8 after 1M iterations.
 *
 * WHY FUNCTION-ARG COUNTERS REQUIRE A FUNCTION ARGUMENT:
 *   numberOfDFGCompiles and its siblings are PER-FUNCTION counters — they ask JSC
 *   "how many times has THIS specific function object been compiled by the DFG tier?".
 *   Calling them with zero arguments returns undefined, NOT zero. The original
 *   task-10 probe called these counters with zero arguments and misinterpreted the
 *   resulting undefined as "counter unavailable on Bun 1.3.8". That was wrong —
 *   the counters work fine; we just need to pass a Function object.
 *
 *   Verified working repro (Bun 1.3.8 darwin/arm64):
 *     const hot = (x: number) => x * x + x
 *     for (let i = 0; i < 1_000_000; i++) hot(i)   // warm into DFG tier
 *     console.log(numberOfDFGCompiles(hot))         // → 1 (real number)
 *
 * Usage:  bun run benchmark/probe-jsc.ts
 * Capture: bun run benchmark/probe-jsc.ts > .chief/milestone-2/_report/task-10/bun-jsc-probe.txt
 *
 * This file is a permanent benchmark toolkit utility. It is NOT deleted after task-10.
 * Future contributors can re-run it any time they want to check the current Bun
 * version's JIT counter surface (e.g. to see if new counters are added or if counter
 * signatures change in a future Bun version).
 */

import * as jsc from 'bun:jsc'

// Cast through Record<string, unknown> once to satisfy verbatimModuleSyntax + strict mode
// without `any` — dynamic property access requires this escape hatch.
const _jscMap = jsc as unknown as Record<string, unknown>

// ---------------------------------------------------------------------------
// Phase A — zero-arg counters
// ---------------------------------------------------------------------------

// Candidates expected to be zero-arg (process-global) counters
const zeroArgCandidates = [
  'totalCompileTime',
  'heapSize',
  'memoryUsage',
  'percentAvailableMemoryInUse',
]

console.log('bun:jsc probe — function categories')
console.log('===================================')
console.log('[zero-arg]')

for (const name of zeroArgCandidates) {
  const fn = _jscMap[name]
  if (typeof fn !== 'function') {
    console.log(`  ${name}() = <not present>`)
    continue
  }
  try {
    const result = (fn as () => unknown)()
    if (typeof result === 'number' && isFinite(result)) {
      const suffix = name === 'totalCompileTime' ? ' ms' : name === 'heapSize' ? ' bytes' : ''
      console.log(`  ${name}() = ${result}${suffix}`)
    } else if (result !== null && result !== undefined && typeof result === 'object') {
      console.log(`  ${name}() = [object] (not a scalar number — skipped for zero-arg category)`)
    } else {
      console.log(`  ${name}() = ${String(result)} (not a finite number)`)
    }
  } catch (e) {
    console.log(`  ${name}() = <throws: ${(e as Error).message}>`)
  }
}

// ---------------------------------------------------------------------------
// Phase B — function-argument counters
// ---------------------------------------------------------------------------

// Create a throwaway hot function and warm it well past the DFG threshold.
// 1M iterations is known to reliably trigger DFG on Bun 1.3.8 darwin/arm64
// (per milestone-2 summary known measurement issues repro).
const probeHot = (x: number): number => x * x + x
for (let i = 0; i < 1_000_000; i++) probeHot(i)

// Candidates expected to be function-arg counters
const fnArgCandidates = [
  'numberOfDFGCompiles',
  'numberOfFTLCompiles',
  'numberOfOSRExits',
  'numberOfOSREntries',
  'reoptimizationRetryCount',
  'optimizeNextInvocation',
  'noFTL',
  'noInline',
]

console.log('[fn-arg]')
console.log('  (probeHot warmed with 1,000,000 iterations before sampling)')

type FnArgCounter = (fn: Function) => unknown

const fnArgAvailable: string[] = []

for (const name of fnArgCandidates) {
  const fn = _jscMap[name]
  if (typeof fn !== 'function') {
    console.log(`  ${name}(probeHot) = <not present>`)
    continue
  }
  try {
    const result = (fn as FnArgCounter)(probeHot)
    if (typeof result === 'number' && isFinite(result)) {
      console.log(`  ${name}(probeHot) = ${result}`)
      fnArgAvailable.push(name)
    } else if (result === undefined) {
      console.log(`  ${name}(probeHot) = <unavailable> (returned undefined — may need different argument or not supported on Bun ${Bun.version})`)
    } else {
      console.log(`  ${name}(probeHot) = <unavailable> (returned ${String(result)}, not a finite number)`)
    }
  } catch (e) {
    console.log(`  ${name}(probeHot) = <throws: ${(e as Error).message}>`)
  }
}

// ---------------------------------------------------------------------------
// Resolved-for-harness decision
// ---------------------------------------------------------------------------

// Determine which zero-arg counters are available
function _probeZeroArgCounter(name: string): boolean {
  const fn = _jscMap[name]
  if (typeof fn !== 'function') return false
  try {
    const sample = (fn as () => unknown)()
    return typeof sample === 'number' && isFinite(sample)
  } catch {
    return false
  }
}

const totalCompileTimeAvailable = _probeZeroArgCounter('totalCompileTime')

console.log('[resolved-for-harness]')
console.log(`  jitCountersAvailable = ${fnArgAvailable.length > 0 ? JSON.stringify(fnArgAvailable) : '[] (no fn-arg counters return finite numbers on Bun ' + Bun.version + ' ' + process.arch + '/' + process.platform + ')'}`)
console.log(`  totalCompileTime (zero-arg) = ${totalCompileTimeAvailable ? 'available' : 'unavailable'}`)
console.log()

// ---------------------------------------------------------------------------
// Full bun:jsc surface enumeration (sorted)
// ---------------------------------------------------------------------------

const allKeys = Object.keys(_jscMap).sort()
console.log('# Full bun:jsc exposed keys (sorted)')
console.log(JSON.stringify(allKeys, null, 2))
console.log()

// ---------------------------------------------------------------------------
// Parameterless function probe — print all zero-arg call results
// ---------------------------------------------------------------------------

console.log('# Parameterless function probe (all zero-arg calls)')
for (const key of allKeys) {
  const v = _jscMap[key]
  if (typeof v !== 'function') continue
  try {
    const result = (v as () => unknown)()
    if (result !== null && result !== undefined && typeof result === 'object') {
      console.log(`${key}(): [object — ${Object.keys(result as object).slice(0, 3).join(', ')}...]`)
    } else {
      console.log(`${key}(): ${String(result)}`)
    }
  } catch (e) {
    console.log(`${key}(): <throws: ${(e as Error).message}>`)
  }
}
