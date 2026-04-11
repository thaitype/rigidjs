import { heapStats } from 'bun:jsc'

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
function liveObjectCount(stats: ReturnType<typeof heapStats>): number {
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
  for (let i = 0; i < warmup; i++) scenario.fn()

  // 5. Force GC before measurement window
  Bun.gc(true)
  await Bun.sleep(100)

  // 6. Snapshot heap before
  const heapBefore = heapStats()

  // 7. Pre-allocate latency buffer — index-assign only, never .push()
  //    (Internal cast: Float64Array stores numbers; no typed user-facing API here.)
  const latencies = new Float64Array(iterations)

  // 8. Timed loop — outer bookends are the source of truth for opsPerSec
  const loopStart = Bun.nanoseconds()
  for (let i = 0; i < iterations; i++) {
    const t0 = Bun.nanoseconds()
    scenario.fn()
    latencies[i] = Bun.nanoseconds() - t0
  }
  const elapsed = Bun.nanoseconds() - loopStart

  // 9. Force GC after measurement window
  Bun.gc(true)
  await Bun.sleep(100)

  // 10. Snapshot heap after
  const heapAfter = heapStats()

  // 11. Optional teardown
  scenario.teardown?.()

  // 12. Sort latencies in-place and compute percentiles in microseconds
  latencies.sort()
  const p50Us = +(latencies[Math.floor(iterations * 0.50)]! / 1000).toFixed(2)
  const p99Us = +(latencies[Math.floor(iterations * 0.99)]! / 1000).toFixed(2)

  // 13. Build and return result
  return {
    name: scenario.name,
    opsPerSec: Math.round((iterations / elapsed) * 1e9),
    heapObjectsBefore: heapBefore.objectCount,
    heapObjectsAfter: heapAfter.objectCount,
    heapObjectsDelta: heapAfter.objectCount - heapBefore.objectCount,
    allocationDelta,
    retainedAfterGC,
    heapSizeMB: +(heapAfter.heapSize / 1024 / 1024).toFixed(2),
    rssMB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(2),
    p50Us,
    p99Us,
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
    ].join('  '),
  )

  return [header, sep, ...rows].join('\n')
}
