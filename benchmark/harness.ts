import { heapStats } from 'bun:jsc'

// Cast jsc through Record<string,unknown> once to satisfy verbatimModuleSyntax + strict mode
// without `any` — the dynamic property access below requires this escape hatch.
import * as jsc from 'bun:jsc'
const _jscMap = jsc as unknown as Record<string, unknown>

// ---------------------------------------------------------------------------
// JIT counter probes — resolved at module load.
//
// IMPORTANT: numberOfDFGCompiles and sibling function-argument counters have
// the signature (fn: Function) => number, NOT () => number. Calling them with
// zero arguments returns undefined, which looks like "counter unavailable" but
// is actually a calling-convention bug. The original task-10 harness called
// these with zero arguments and therefore always got null deltas.
//
// Correct usage (verified on Bun 1.3.8 darwin/arm64):
//   const hot = (x: number) => x * x + x
//   for (let i = 0; i < 1_000_000; i++) hot(i)   // warm into DFG tier
//   numberOfDFGCompiles(hot)                       // → 1 (real number)
//
// Fix (milestone-3 task-1): probe function-arg counters by calling a warmed
// throwaway function as argument. Sampling in bench() / benchSustained() passes
// scenario.fn / scenario.tick as the function argument.
//
// BLIND SPOT: numberOfDFGCompiles(scenario.fn) measures recompiles of the
// WRAPPER CLOSURE only. It does NOT capture recompiles of nested functions
// called inside the wrapper — JSC tracks those separately per Function object.
// totalCompileTime() delta is the process-global catch-all that covers nested
// functions. Together, the two signals are the best available from userland
// without JSC internals access.
// ---------------------------------------------------------------------------

type FnArgCounter = (fn: Function) => number

/**
 * Probe a zero-arg counter. Returns the function if it returns a finite number
 * when called with no arguments; null otherwise.
 */
function _probeZeroArgCounter(name: string): (() => number) | null {
  const fn = _jscMap[name]
  if (typeof fn !== 'function') return null
  try {
    const sample = (fn as () => unknown)()
    if (typeof sample === 'number' && isFinite(sample)) return fn as () => number
  } catch {
    // throws on this version — treat as unavailable
  }
  return null
}

/**
 * Probe a function-argument counter. Creates a throwaway warmed function,
 * calls the counter with it, and returns the counter function if the result
 * is a finite number. Returns null if the counter is absent or returns
 * undefined/non-number (which would indicate a truly unavailable counter,
 * not the calling-convention bug from task-10).
 */
function _probeFunctionArgCounter(name: string): FnArgCounter | null {
  const fn = _jscMap[name]
  if (typeof fn !== 'function') return null
  // Create a dedicated throwaway probe function and warm it past DFG threshold
  const warmFn = (x: number): number => x * x + x
  for (let i = 0; i < 1_000_000; i++) warmFn(i)
  try {
    const sample = (fn as FnArgCounter)(warmFn)
    if (typeof sample === 'number' && isFinite(sample)) return fn as FnArgCounter
  } catch {
    // throws on this version — treat as unavailable
  }
  return null
}

// Function-argument counters (per-function JIT statistics)
const dfgCompilesFn: FnArgCounter | null = _probeFunctionArgCounter('numberOfDFGCompiles')
const ftlCompilesFn: FnArgCounter | null = _probeFunctionArgCounter('numberOfFTLCompiles')
const osrExitsFn: FnArgCounter | null = _probeFunctionArgCounter('numberOfOSRExits')

// Zero-arg counter: process-global total JSC compile time in milliseconds since process start.
// This is a catch-all that covers ALL function compilations during the sampling window,
// not just the scenario wrapper — making it complementary to the per-function dfgCompilesFn.
const totalCompileTimeFn: (() => number) | null = _probeZeroArgCounter('totalCompileTime')

// List of JIT counter names that are actually available on this Bun version
// (fn-arg counters listed first, then zero-arg process-global counters)
export const jitCountersAvailable: string[] = [
  dfgCompilesFn !== null ? 'numberOfDFGCompiles' : null,
  ftlCompilesFn !== null ? 'numberOfFTLCompiles' : null,
  osrExitsFn !== null ? 'numberOfOSRExits' : null,
  totalCompileTimeFn !== null ? 'totalCompileTime' : null,
].filter((s): s is string => s !== null)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Counts live objects by summing objectTypeCounts values.
 *
 * heapStats().objectCount is a stale cached value that only refreshes during
 * a GC collection. objectTypeCounts is populated on every heapStats() call
 * and reflects the actual current live counts. Summing it gives a live total
 * that correctly captures peak allocation pressure between GC calls.
 */
export function liveObjectCount(stats: ReturnType<typeof heapStats>): number {
  let total = 0
  for (const count of Object.values(stats.objectTypeCounts)) {
    total += count
  }
  return total
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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
  ftlCompilesDelta: number | null       // null when counter not present on this Bun version
  osrExitsDelta: number | null          // null when counter not present on this Bun version
  highWaterRssMB: number
  // --- milestone-3 task-1 additions (appended only) ---
  /**
   * Process-global JSC compile time delta across the measurement window.
   * Includes compiles of any function, not just scenario.fn.
   * Zero or very small delta means the window was JIT-stable end to end.
   * Complements dfgCompilesDelta (which only measures the wrapper closure).
   */
  totalCompileTimeMsDelta: number | null
}

export interface Scenario {
  name: string
  setup: () => void
  fn: () => void
  teardown?: () => void
  iterations?: number
  warmup?: number
  /**
   * Optional one-shot allocation measurement. Called exactly once per
   * scenario. Must perform the full target allocation (e.g. 100k object
   * creations) and return a reference that keeps the allocated state
   * reachable so heapStats() can sample the live peak before anything is
   * collected. The harness samples heapStats() before and after this call
   * WITHOUT forcing GC in between.
   */
  allocate?: () => unknown
}

// ---------------------------------------------------------------------------
// Core bench runner
// ---------------------------------------------------------------------------

export async function bench(scenario: Scenario): Promise<BenchResult> {
  const iterations = scenario.iterations ?? 10_000
  const warmup = scenario.warmup ?? 1_000

  // 1. Setup
  scenario.setup()

  // 2. Allocation measurement phase (before warmup/timing, if allocate is defined)
  let allocationDelta: number | null = null
  let retainedAfterGC: number | null = null

  if (scenario.allocate !== undefined) {
    // 2a. Force GC to get a clean slate before allocation measurement
    Bun.gc(true)
    await Bun.sleep(100)

    // 2b. Sample heap before allocation using live object count.
    //     NOTE: heapStats().objectCount is a stale cached value updated only
    //     during GC; liveObjectCount() sums objectTypeCounts which IS live.
    const heapBefore = heapStats()
    const beforeLive = liveObjectCount(heapBefore)

    // 2c. One-shot allocation — declared as let so the retained = null assignment
    //     below is a genuine write (defeats JIT dead-reference elimination)
    let retained: unknown = scenario.allocate()

    // 2d. Sample heap after allocation — NO GC, NO sleep, NO other work between
    //     heapBefore and heapAfter so we capture the live peak
    const heapAfter = heapStats()
    const afterLive = liveObjectCount(heapAfter)

    // Anti-DCE: pin the retained reference through the heapAfter sample so the
    // JIT cannot observe it as dead and collect it before heapStats() runs
    void retained

    // 2e. Compute allocation delta using live counts (not stale objectCount)
    allocationDelta = afterLive - beforeLive

    // 2f. Release the reference and force GC to measure retained-after-GC
    retained = null
    Bun.gc(true)
    await Bun.sleep(100)
    const heapReleased = heapStats()
    const releasedLive = liveObjectCount(heapReleased)

    // 2g. Compute retained-after-GC delta (relative to the clean-slate heapBefore)
    retainedAfterGC = releasedLive - beforeLive
  }

  // 3. Reset before timing phase (whether or not allocation phase ran)
  Bun.gc(true)
  await Bun.sleep(100)

  // 4. Warmup — let JSC JIT compile without timing
  // --- task-10: CPU / JIT bracket begins immediately BEFORE warmup ---
  // NOTE (milestone-3 task-1 fix): dfgCompilesFn takes scenario.fn as argument —
  // it measures recompiles of the wrapper closure specifically. totalCompileTimeFn
  // is zero-arg and process-global (covers all functions compiled during the window).
  const cpuStart = process.cpuUsage()
  const jitStart = {
    dfg: dfgCompilesFn !== null ? dfgCompilesFn(scenario.fn) : null,
    ftl: ftlCompilesFn !== null ? ftlCompilesFn(scenario.fn) : null,
    osrExits: osrExitsFn !== null ? osrExitsFn(scenario.fn) : null,
    totalCompileTimeMs: totalCompileTimeFn !== null ? totalCompileTimeFn() : null,
  }

  for (let i = 0; i < warmup; i++) scenario.fn()

  // 5. Force GC before measurement window
  Bun.gc(true)
  await Bun.sleep(100)

  // 6. Snapshot heap before
  const heapBefore = heapStats()

  // 7. Pre-allocate latency buffer — index-assign only, never .push()
  //    (Internal cast: Float64Array stores numbers; no typed user-facing API here.)
  const latencies = new Float64Array(iterations)

  // --- task-10: RSS high-water tracking — strategy: strided polling with ~16 probes
  // Compute a power-of-two mask that fires approximately 16 times across the window.
  // This adds at most 16 syscalls total, well within the 5% overhead budget.
  const sampleMask =
    (1 << Math.max(0, Math.ceil(Math.log2(Math.max(1, iterations / 16))))) - 1
  let highWaterRssBytes = process.memoryUsage().rss  // initial sample

  // 8. Timed loop — outer bookends are the source of truth for opsPerSec
  const loopStart = Bun.nanoseconds()
  for (let i = 0; i < iterations; i++) {
    const t0 = Bun.nanoseconds()
    scenario.fn()
    latencies[i] = Bun.nanoseconds() - t0
    // Strided RSS probe — cheap: ~16 syscalls total across entire loop
    if ((i & sampleMask) === 0) {
      const rss = process.memoryUsage().rss
      if (rss > highWaterRssBytes) highWaterRssBytes = rss
    }
  }
  const elapsed = Bun.nanoseconds() - loopStart

  // 9. Force GC after measurement window
  Bun.gc(true)
  await Bun.sleep(100)

  // 10. Snapshot heap after
  const heapAfter = heapStats()

  // --- task-10: read CPU / JIT end deltas (bracket ends AFTER post-loop GC)
  // NOTE (milestone-3 task-1 fix): pass scenario.fn as argument to fn-arg counters.
  const cpuEnd = process.cpuUsage(cpuStart)
  const jitEnd = {
    dfg: dfgCompilesFn !== null ? dfgCompilesFn(scenario.fn) : null,
    ftl: ftlCompilesFn !== null ? ftlCompilesFn(scenario.fn) : null,
    osrExits: osrExitsFn !== null ? osrExitsFn(scenario.fn) : null,
    totalCompileTimeMs: totalCompileTimeFn !== null ? totalCompileTimeFn() : null,
  }

  // Final RSS sample for high-water max
  const endRss = process.memoryUsage().rss
  if (endRss > highWaterRssBytes) highWaterRssBytes = endRss

  // 11. Optional teardown
  scenario.teardown?.()

  // 12. Sort latencies in-place and compute percentiles in microseconds
  latencies.sort()
  const p50Us = +(latencies[Math.floor(iterations * 0.50)]! / 1000).toFixed(2)
  const p99Us = +(latencies[Math.floor(iterations * 0.99)]! / 1000).toFixed(2)

  // 13. Compute task-10 fields
  const cpuUserUs = cpuEnd.user
  const cpuSystemUs = cpuEnd.system
  const cpuTotalUs = cpuEnd.user + cpuEnd.system

  const dfgCompilesDelta =
    jitEnd.dfg !== null && jitStart.dfg !== null ? jitEnd.dfg - jitStart.dfg : null
  const ftlCompilesDelta =
    jitEnd.ftl !== null && jitStart.ftl !== null ? jitEnd.ftl - jitStart.ftl : null
  const osrExitsDelta =
    jitEnd.osrExits !== null && jitStart.osrExits !== null
      ? jitEnd.osrExits - jitStart.osrExits
      : null
  const totalCompileTimeMsDelta =
    jitEnd.totalCompileTimeMs !== null && jitStart.totalCompileTimeMs !== null
      ? jitEnd.totalCompileTimeMs - jitStart.totalCompileTimeMs
      : null

  // Final RSS sample — taken at result-build time to match rssMB. Update high-water
  // once more so highWaterRssMB >= rssMB is always true (teardown may move RSS slightly).
  const finalRss = process.memoryUsage().rss
  if (finalRss > highWaterRssBytes) highWaterRssBytes = finalRss

  const highWaterRssMB = +(highWaterRssBytes / (1024 * 1024)).toFixed(2)

  // 14. Build and return result
  return {
    name: scenario.name,
    opsPerSec: Math.round((iterations / elapsed) * 1e9),
    heapObjectsBefore: heapBefore.objectCount,
    heapObjectsAfter: heapAfter.objectCount,
    heapObjectsDelta: heapAfter.objectCount - heapBefore.objectCount,
    allocationDelta,
    retainedAfterGC,
    heapSizeMB: +(heapAfter.heapSize / 1024 / 1024).toFixed(2),
    rssMB: +(finalRss / (1024 * 1024)).toFixed(2),
    p50Us,
    p99Us,
    cpuUserUs,
    cpuSystemUs,
    cpuTotalUs,
    dfgCompilesDelta,
    ftlCompilesDelta,
    osrExitsDelta,
    highWaterRssMB,
    totalCompileTimeMsDelta,
  }
}

// ---------------------------------------------------------------------------
// runAll — runs all scenarios with GC isolation between them
// ---------------------------------------------------------------------------

export async function runAll(scenarios: Scenario[]): Promise<BenchResult[]> {
  const results: BenchResult[] = []
  for (const scenario of scenarios) {
    Bun.gc(true)
    await Bun.sleep(100)
    const result = await bench(scenario)
    results.push(result)
  }
  return results
}

// ---------------------------------------------------------------------------
// formatTable — fixed-width plain-text summary table
// Strategy: widen-the-table (add cpuMs, dfgΔ, hwRssMB columns without removing any)
// ---------------------------------------------------------------------------

export function formatTable(results: BenchResult[]): string {
  const COL_NAME = 36
  const COL_OPS = 12
  const COL_HEAP_DELTA = 10
  const COL_ALLOC_DELTA = 12
  const COL_RETAINED = 12
  const COL_HEAP_MB = 9
  const COL_RSS = 9
  const COL_P50 = 9
  const COL_P99 = 9
  const COL_CPU_MS = 10
  const COL_DFG = 7
  const COL_HW_RSS = 10
  const COL_COMPILE_MS = 12

  function pad(s: string, n: number, right = false): string {
    return right ? s.padStart(n) : s.padEnd(n)
  }

  function fmtNullable(v: number | null): string {
    return v === null ? '-' : v.toLocaleString()
  }

  const header = [
    pad('name', COL_NAME),
    pad('ops/s', COL_OPS, true),
    pad('heapΔ', COL_HEAP_DELTA, true),
    pad('allocΔ', COL_ALLOC_DELTA, true),
    pad('retained', COL_RETAINED, true),
    pad('heapMB', COL_HEAP_MB, true),
    pad('rssMB', COL_RSS, true),
    pad('p50µs', COL_P50, true),
    pad('p99µs', COL_P99, true),
    pad('cpuMs', COL_CPU_MS, true),
    pad('dfgΔ', COL_DFG, true),
    pad('hwRssMB', COL_HW_RSS, true),
    pad('totalCmpMs', COL_COMPILE_MS, true),
  ].join('  ')

  const sep = '-'.repeat(header.length)

  const rows = results.map((r) =>
    [
      pad(r.name, COL_NAME),
      pad(r.opsPerSec.toLocaleString(), COL_OPS, true),
      pad(r.heapObjectsDelta.toLocaleString(), COL_HEAP_DELTA, true),
      pad(fmtNullable(r.allocationDelta), COL_ALLOC_DELTA, true),
      pad(fmtNullable(r.retainedAfterGC), COL_RETAINED, true),
      pad(r.heapSizeMB.toFixed(2), COL_HEAP_MB, true),
      pad(r.rssMB.toFixed(2), COL_RSS, true),
      pad(r.p50Us.toFixed(2), COL_P50, true),
      pad(r.p99Us.toFixed(2), COL_P99, true),
      pad((r.cpuTotalUs / 1000).toFixed(1), COL_CPU_MS, true),
      pad(fmtNullable(r.dfgCompilesDelta), COL_DFG, true),
      pad(r.highWaterRssMB.toFixed(2), COL_HW_RSS, true),
      pad(r.totalCompileTimeMsDelta !== null ? r.totalCompileTimeMsDelta.toFixed(1) : '-', COL_COMPILE_MS, true),
    ].join('  '),
  )

  return [header, sep, ...rows].join('\n')
}

// ---------------------------------------------------------------------------
// Sustained-load types
// ---------------------------------------------------------------------------

export interface HeapSample {
  tick: number           // tick index at the moment of sampling
  liveObjects: number    // liveObjectCount(heapStats())
  rssMB: number          // process.memoryUsage().rss / (1024*1024), 2 decimals
}

export interface SustainedScenario {
  name: string
  setup?: () => void
  tick: () => void
  teardown?: () => void
  /** Wall-clock duration budget in milliseconds. */
  durationMs: number
  /** Number of ticks to run untimed before measurement (default 50). */
  warmupTicks?: number
  /**
   * Optional one-shot allocation measurement, same contract as Scenario.allocate
   * from task-8. If present, the harness runs it once before the timing window
   * and records allocationDelta. If absent, allocationDelta is null.
   */
  allocate?: () => unknown
  /**
   * task-10: opt-in per-tick heap time-series collection. Default false.
   * Only meaningful for long-window scenarios (B8). B9 leaves this unset (null).
   */
  collectHeapTimeSeries?: boolean
}

export interface SustainedResult {
  name: string
  /** Capacity tag for B9 scaling runs; undefined for plain B8. */
  capacity?: number
  ticksCompleted: number
  meanTickMs: number
  stdDevTickMs: number
  p50TickMs: number
  p99TickMs: number
  p999TickMs: number
  maxTickMs: number
  /** Optional one-shot allocation pressure from scenario.allocate(). */
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
  // --- milestone-3 task-1 additions (appended only) ---
  /**
   * Process-global JSC compile time delta across the measurement window.
   * Includes compiles of any function, not just scenario.tick.
   * Zero or very small delta means the window was JIT-stable end to end.
   * Complements dfgCompilesDelta (which only measures the tick wrapper closure).
   */
  totalCompileTimeMsDelta: number | null
}

// ---------------------------------------------------------------------------
// benchSustained — time-budgeted sustained tick benchmark
// ---------------------------------------------------------------------------

export async function benchSustained(scenario: SustainedScenario): Promise<SustainedResult> {
  const warmupTicks = scenario.warmupTicks ?? 50
  const collectHeapTimeSeries = scenario.collectHeapTimeSeries === true

  // 1. Setup
  scenario.setup?.()

  // 2. Optional one-shot allocation measurement phase
  let allocationDelta: number | null = null

  if (scenario.allocate !== undefined) {
    // Force GC for clean slate
    Bun.gc(true)
    await Bun.sleep(100)

    const beforeStats = heapStats()
    const beforeLive = liveObjectCount(beforeStats)

    // One-shot allocation — declared as let so retained = null below is a real write
    let retained: unknown = scenario.allocate()

    // Sample after with no GC/sleep between so we see the live peak
    const afterStats = heapStats()
    const afterLive = liveObjectCount(afterStats)

    // Anti-DCE: pin retained through the heapAfter sample so the JIT cannot
    // observe it as dead and collect it before heapStats() runs
    void retained

    allocationDelta = afterLive - beforeLive

    retained = null
    Bun.gc(true)
    await Bun.sleep(100)
  }

  // 3. GC + sleep before warmup
  Bun.gc(true)
  await Bun.sleep(100)

  // 4. Warmup — prime JIT without timing
  // --- task-10: CPU / JIT bracket begins immediately BEFORE warmup ---
  // NOTE (milestone-3 task-1 fix): dfgCompilesFn takes scenario.tick as argument —
  // it measures recompiles of the tick wrapper closure specifically.
  const cpuStart = process.cpuUsage()
  const jitStart = {
    dfg: dfgCompilesFn !== null ? dfgCompilesFn(scenario.tick) : null,
    ftl: ftlCompilesFn !== null ? ftlCompilesFn(scenario.tick) : null,
    osrExits: osrExitsFn !== null ? osrExitsFn(scenario.tick) : null,
    totalCompileTimeMs: totalCompileTimeFn !== null ? totalCompileTimeFn() : null,
  }

  for (let i = 0; i < warmupTicks; i++) scenario.tick()

  // 5. GC + sleep before measurement window
  Bun.gc(true)
  await Bun.sleep(100)

  // 6. Pre-size latency buffer — hard cap at Math.ceil(durationMs * 100) entries.
  //    Spec originally specified durationMs * 2 (~2000 ticks/sec headroom), but
  //    on Apple M-series hardware small-capacity scenarios complete ticks in
  //    <0.025ms (>40000 ticks/sec), so the multiplier is bumped to 100
  //    (~100000 ticks/sec ceiling) to keep the "plenty of headroom" intent
  //    intact across all B8/B9 capacities. Throw on overflow rather than
  //    silently grow or truncate.
  const maxTicks = Math.ceil(scenario.durationMs * 100)
  const latencies = new Float64Array(maxTicks)
  let ticksCompleted = 0

  // --- task-10: heap time-series setup
  // Estimate expected ticks from durationMs * typical rate.
  // Use conservative upper bound of durationMs * 6000 ticks/sec (well above B8 rates).
  // N = max(50, ceil(expectedTicks / 500)) to keep samples <= 500 and spanning full window.
  const expectedTicks = scenario.durationMs * 6000 / 1000  // ~ ticks we expect
  const timeSeriesN = Math.max(50, Math.ceil(expectedTicks / 500))
  const heapTimeSeries: HeapSample[] = []

  // --- task-10: high-water RSS — sampled at each tick boundary (affordable in sustained mode)
  let highWaterRssBytes = process.memoryUsage().rss

  // 7 + 8. Timing loop with runaway guard
  const windowStart = Bun.nanoseconds()
  const deadline = windowStart + scenario.durationMs * 1_000_000
  const runawayCeiling = windowStart + scenario.durationMs * 3 * 1_000_000

  while (Bun.nanoseconds() < deadline) {
    if (Bun.nanoseconds() >= runawayCeiling) {
      throw new Error(
        `[benchSustained] Runaway guard triggered for scenario "${scenario.name}": ` +
          `loop exceeded ${scenario.durationMs * 3}ms wall time. ` +
          `Ticks completed so far: ${ticksCompleted}.`,
      )
    }
    if (ticksCompleted >= maxTicks) {
      throw new Error(
        `[benchSustained] Latency buffer overflow for scenario "${scenario.name}": ` +
          `tick count ${ticksCompleted} exceeds pre-sized buffer cap of ${maxTicks} ` +
          `(Math.ceil(durationMs * 100) = Math.ceil(${scenario.durationMs} * 100)).`,
      )
    }

    // --- task-10: per-tick RSS sample (before tick body)
    const tickRss = process.memoryUsage().rss
    if (tickRss > highWaterRssBytes) highWaterRssBytes = tickRss

    const t0 = Bun.nanoseconds()
    scenario.tick()
    latencies[ticksCompleted] = Bun.nanoseconds() - t0
    ticksCompleted++

    // --- task-10: throttled heap time-series sample
    if (collectHeapTimeSeries && heapTimeSeries.length < 500 && ticksCompleted % timeSeriesN === 0) {
      heapTimeSeries.push({
        tick: ticksCompleted,
        liveObjects: liveObjectCount(heapStats()),
        rssMB: +(process.memoryUsage().rss / (1024 * 1024)).toFixed(2),
      })
    }
  }

  // 9. Teardown
  scenario.teardown?.()

  // 10. GC + sleep, then sample heap
  Bun.gc(true)
  await Bun.sleep(100)
  const finalStats = heapStats()
  const heapSizeMB = +(finalStats.heapSize / 1024 / 1024).toFixed(2)

  // --- task-10: read CPU / JIT end (bracket ends AFTER post-loop GC + sleep)
  // NOTE (milestone-3 task-1 fix): pass scenario.tick as argument to fn-arg counters.
  const cpuEnd = process.cpuUsage(cpuStart)
  const jitEnd = {
    dfg: dfgCompilesFn !== null ? dfgCompilesFn(scenario.tick) : null,
    ftl: ftlCompilesFn !== null ? ftlCompilesFn(scenario.tick) : null,
    osrExits: osrExitsFn !== null ? osrExitsFn(scenario.tick) : null,
    totalCompileTimeMs: totalCompileTimeFn !== null ? totalCompileTimeFn() : null,
  }

  // Final RSS — sampled once and used for both rssMB and high-water update so
  // highWaterRssMB >= rssMB is guaranteed regardless of post-GC RSS movement.
  const finalRssBytes = process.memoryUsage().rss
  if (finalRssBytes > highWaterRssBytes) highWaterRssBytes = finalRssBytes
  const rssMB = +(finalRssBytes / (1024 * 1024)).toFixed(2)

  // 11. Compute statistics from filled prefix — convert ns → ms
  const used = latencies.subarray(0, ticksCompleted)

  let sum = 0
  for (let i = 0; i < ticksCompleted; i++) sum += used[i]!
  const meanNs = sum / ticksCompleted
  const meanTickMs = +(meanNs / 1_000_000).toFixed(4)

  let variance = 0
  for (let i = 0; i < ticksCompleted; i++) {
    const diff = used[i]! - meanNs
    variance += diff * diff
  }
  const stdDevTickMs = +(Math.sqrt(variance / ticksCompleted) / 1_000_000).toFixed(4)

  // Sort a copy for percentile computation
  const sorted = new Float64Array(used)
  sorted.sort()
  const n = ticksCompleted
  const p50TickMs = +(sorted[Math.floor(n * 0.5)]! / 1_000_000).toFixed(4)
  const p99TickMs = +(sorted[Math.floor(n * 0.99)]! / 1_000_000).toFixed(4)
  const p999TickMs = +(sorted[Math.floor(n * 0.999)]! / 1_000_000).toFixed(4)
  const maxTickMs = +(sorted[n - 1]! / 1_000_000).toFixed(4)

  // 12. Compute task-10 CPU / JIT / RSS fields
  const cpuUserUs = cpuEnd.user
  const cpuSystemUs = cpuEnd.system
  const cpuTotalUs = cpuEnd.user + cpuEnd.system

  const dfgCompilesDelta =
    jitEnd.dfg !== null && jitStart.dfg !== null ? jitEnd.dfg - jitStart.dfg : null
  const ftlCompilesDelta =
    jitEnd.ftl !== null && jitStart.ftl !== null ? jitEnd.ftl - jitStart.ftl : null
  const osrExitsDelta =
    jitEnd.osrExits !== null && jitStart.osrExits !== null
      ? jitEnd.osrExits - jitStart.osrExits
      : null
  const totalCompileTimeMsDelta =
    jitEnd.totalCompileTimeMs !== null && jitStart.totalCompileTimeMs !== null
      ? jitEnd.totalCompileTimeMs - jitStart.totalCompileTimeMs
      : null

  const highWaterRssMB = +(highWaterRssBytes / (1024 * 1024)).toFixed(2)

  // 13. Return result — capacity left undefined unless set by benchScaling
  return {
    name: scenario.name,
    ticksCompleted,
    meanTickMs,
    stdDevTickMs,
    p50TickMs,
    p99TickMs,
    p999TickMs,
    maxTickMs,
    allocationDelta,
    heapSizeMB,
    rssMB,
    cpuUserUs,
    cpuSystemUs,
    cpuTotalUs,
    dfgCompilesDelta,
    ftlCompilesDelta,
    osrExitsDelta,
    highWaterRssMB,
    heapTimeSeries: collectHeapTimeSeries ? heapTimeSeries : null,
    totalCompileTimeMsDelta,
  }
}

// ---------------------------------------------------------------------------
// benchScaling — run a scenario factory across multiple capacities
// ---------------------------------------------------------------------------

export async function benchScaling<T extends SustainedScenario>(
  scenarioFactory: (capacity: number) => T,
  capacities: number[],
): Promise<SustainedResult[]> {
  const results: SustainedResult[] = []
  for (const capacity of capacities) {
    Bun.gc(true)
    await Bun.sleep(100)
    const scenario = scenarioFactory(capacity)
    const result = await benchSustained(scenario)
    result.capacity = capacity
    results.push(result)
  }
  return results
}

// ---------------------------------------------------------------------------
// formatSustainedTable — plain-text fixed-width table for sustained results
// Strategy: widen-the-table (add cpuMs, dfgΔ, hwRssMB columns without removing any)
// ---------------------------------------------------------------------------

export function formatSustainedTable(results: SustainedResult[]): string {
  const COL_NAME = 36
  const COL_CAP = 10
  const COL_TICKS = 8
  const COL_MEAN = 10
  const COL_P50 = 10
  const COL_P99 = 10
  const COL_P999 = 10
  const COL_MAX = 10
  const COL_ALLOC = 10
  const COL_HEAP = 9
  const COL_RSS = 9
  const COL_CPU_MS = 10
  const COL_DFG = 7
  const COL_HW_RSS = 10
  const COL_COMPILE_MS = 12

  function pad(s: string, n: number, right = false): string {
    return right ? s.padStart(n) : s.padEnd(n)
  }

  function fmtCap(v: number | undefined): string {
    return v === undefined ? '-' : v.toLocaleString()
  }

  function fmtAlloc(v: number | null): string {
    return v === null ? '-' : v.toLocaleString()
  }

  const header = [
    pad('name', COL_NAME),
    pad('cap', COL_CAP, true),
    pad('ticks', COL_TICKS, true),
    pad('meanMs', COL_MEAN, true),
    pad('p50Ms', COL_P50, true),
    pad('p99Ms', COL_P99, true),
    pad('p999Ms', COL_P999, true),
    pad('maxMs', COL_MAX, true),
    pad('allocΔ', COL_ALLOC, true),
    pad('heapMB', COL_HEAP, true),
    pad('rssMB', COL_RSS, true),
    pad('cpuMs', COL_CPU_MS, true),
    pad('dfgΔ', COL_DFG, true),
    pad('hwRssMB', COL_HW_RSS, true),
    pad('totalCmpMs', COL_COMPILE_MS, true),
  ].join('  ')

  const sep = '-'.repeat(header.length)

  const rows = results.map((r) =>
    [
      pad(r.name, COL_NAME),
      pad(fmtCap(r.capacity), COL_CAP, true),
      pad(r.ticksCompleted.toLocaleString(), COL_TICKS, true),
      pad(r.meanTickMs.toFixed(4), COL_MEAN, true),
      pad(r.p50TickMs.toFixed(4), COL_P50, true),
      pad(r.p99TickMs.toFixed(4), COL_P99, true),
      pad(r.p999TickMs.toFixed(4), COL_P999, true),
      pad(r.maxTickMs.toFixed(4), COL_MAX, true),
      pad(fmtAlloc(r.allocationDelta), COL_ALLOC, true),
      pad(r.heapSizeMB.toFixed(2), COL_HEAP, true),
      pad(r.rssMB.toFixed(2), COL_RSS, true),
      pad((r.cpuTotalUs / 1000).toFixed(1), COL_CPU_MS, true),
      pad(r.dfgCompilesDelta !== null ? r.dfgCompilesDelta.toString() : '-', COL_DFG, true),
      pad(r.highWaterRssMB.toFixed(2), COL_HW_RSS, true),
      pad(r.totalCompileTimeMsDelta !== null ? r.totalCompileTimeMsDelta.toFixed(1) : '-', COL_COMPILE_MS, true),
    ].join('  '),
  )

  return [header, sep, ...rows].join('\n')
}

// ---------------------------------------------------------------------------
// formatSparkline — ASCII sparkline using Unicode block characters
// ---------------------------------------------------------------------------

/**
 * Returns a sparkline string of up to 40 characters rendered from the input
 * number series using Unicode block characters ▁▂▃▄▅▆▇█.
 *
 * - If series.length <= 1 or min === max, returns flat ▄ × min(length, 40).
 * - If series.length > 40, downsamples by taking every ceil(length/40)th element.
 * - Pure function, no side effects.
 */
export function formatSparkline(series: readonly number[]): string {
  const BLOCKS = '▁▂▃▄▅▆▇█'
  const MAX_CHARS = 40

  if (series.length === 0) return ''

  // Downsample if needed
  let sampled: readonly number[]
  if (series.length > MAX_CHARS) {
    const stride = Math.ceil(series.length / MAX_CHARS)
    const downsampled: number[] = []
    for (let i = 0; i < series.length; i += stride) {
      downsampled.push(series[i]!)
    }
    sampled = downsampled
  } else {
    sampled = series
  }

  if (sampled.length <= 1) {
    return '▄'
  }

  let min = sampled[0]!
  let max = sampled[0]!
  for (const v of sampled) {
    if (v < min) min = v
    if (v > max) max = v
  }

  // Flat series — return constant sparkline
  if (min === max) {
    return '▄'.repeat(sampled.length)
  }

  const range = max - min
  return sampled
    .map((v) => {
      const normalized = (v - min) / range
      const bucket = Math.min(7, Math.floor(normalized * 8))
      return BLOCKS[bucket]!
    })
    .join('')
}
