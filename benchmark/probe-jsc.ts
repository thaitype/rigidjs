/**
 * benchmark/probe-jsc.ts
 *
 * Enumerates the `bun:jsc` module surface for the current Bun runtime and
 * prints each exposed function's name and (if parameterless) its return value.
 * Used by task-10 to decide which JIT recompile / OSR counters to wire into
 * the benchmark harness, and re-runnable any time the Bun version changes.
 *
 * Usage:  bun run benchmark/probe-jsc.ts
 * Capture: bun run benchmark/probe-jsc.ts > .chief/milestone-2/_report/task-10/bun-jsc-probe.txt
 *
 * This file is a permanent benchmark toolkit utility. It is NOT deleted after task-10.
 * Future contributors can re-run it any time they want to check the current Bun
 * version's JIT counter surface (e.g. to see if numberOfDFGCompiles starts returning
 * a numeric value in a newer Bun version, or if new counters are added).
 */

import * as jsc from 'bun:jsc'

// Cast through Record<string, unknown> once to satisfy verbatimModuleSyntax + strict mode
// without `any` — dynamic property access requires this escape hatch.
const _jscMap = jsc as Record<string, unknown>

const keys = Object.keys(_jscMap).sort()
console.log('# bun:jsc exposed keys')
console.log(JSON.stringify(keys, null, 2))
console.log()
console.log('# parameterless function probe')

for (const key of keys) {
  const v = _jscMap[key]
  if (typeof v !== 'function') continue
  try {
    const result = (v as () => unknown)()
    console.log(`${key}(): ${String(result)}`)
  } catch (e) {
    console.log(`${key}(): <throws: ${(e as Error).message}>`)
  }
}

console.log()
console.log('--- Probe Summary ---')

// Check the specific JIT counters the harness cares about
const jitCandidates = [
  'numberOfDFGCompiles',
  'numberOfFTLCompiles',
  'numberOfOSRExits',
  'numberOfOSREntries',
  'reoptimizationRetryCount',
  'totalCompileTime',
]

for (const name of jitCandidates) {
  const fn = _jscMap[name]
  if (typeof fn !== 'function') {
    console.log(`${name}: NOT present (no key in Object.keys(jsc))`)
    continue
  }
  try {
    const result = (fn as () => unknown)()
    if (typeof result === 'number' && isFinite(result)) {
      console.log(`${name}: present as function, returns ${result} (usable counter)`)
    } else {
      console.log(`${name}: present as function, returns ${String(result)} (not a number on this Bun version ${Bun.version})`)
    }
  } catch (e) {
    console.log(`${name}: present as function, throws: ${(e as Error).message}`)
  }
}

// Determine which counters the harness should wire up
function _probeCounter(name: string): boolean {
  const fn = _jscMap[name]
  if (typeof fn !== 'function') return false
  try {
    const sample = (fn as () => unknown)()
    return typeof sample === 'number' && isFinite(sample)
  } catch {
    return false
  }
}

const dfgAvailable = _probeCounter('numberOfDFGCompiles')
const ftlAvailable = _probeCounter('numberOfFTLCompiles')
const osrExitsAvailable = _probeCounter('numberOfOSRExits')

console.log()
console.log(`Decision: dfgCompilesFn = ${dfgAvailable ? 'available (returns numeric)' : 'null (returns undefined, not a countable number)'}`)
console.log(`          ftlCompilesFn = ${ftlAvailable ? 'available (returns numeric)' : 'null (function not present)'}`)
console.log(`          osrExitsFn = ${osrExitsAvailable ? 'available (returns numeric)' : 'null (function not present)'}`)

const available: string[] = []
if (dfgAvailable) available.push('numberOfDFGCompiles')
if (ftlAvailable) available.push('numberOfFTLCompiles')
if (osrExitsAvailable) available.push('numberOfOSRExits')

console.log(`meta.jitCountersAvailable = ${available.length > 0 ? JSON.stringify(available) : '[] (no counters produce numeric values on Bun ' + Bun.version + ' ' + process.arch + ' ' + process.platform + ')'}`)
