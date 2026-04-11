import { heapStats } from 'bun:jsc'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BenchResult {
  name: string
  opsPerSec: number
  heapObjectsBefore: number
  heapObjectsAfter: number
  heapObjectsDelta: number
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
}

// ---------------------------------------------------------------------------
// Core bench runner
// ---------------------------------------------------------------------------

export async function bench(scenario: Scenario): Promise<BenchResult> {
  const iterations = scenario.iterations ?? 10_000
  const warmup = scenario.warmup ?? 1_000

  // 1. Setup
  scenario.setup()

  // 2. Warmup — let JSC JIT compile without timing
  for (let i = 0; i < warmup; i++) scenario.fn()

  // 3. Force GC before measurement window
  Bun.gc(true)
  await Bun.sleep(100)

  // 4. Snapshot heap before
  const heapBefore = heapStats()

  // 5. Pre-allocate latency buffer — index-assign only, never .push()
  //    (Internal cast: Float64Array stores numbers; no typed user-facing API here.)
  const latencies = new Float64Array(iterations)

  // 6. Timed loop — outer bookends are the source of truth for opsPerSec
  const loopStart = Bun.nanoseconds()
  for (let i = 0; i < iterations; i++) {
    const t0 = Bun.nanoseconds()
    scenario.fn()
    latencies[i] = Bun.nanoseconds() - t0
  }
  const elapsed = Bun.nanoseconds() - loopStart

  // 7. Force GC after measurement window
  Bun.gc(true)
  await Bun.sleep(100)

  // 8. Snapshot heap after
  const heapAfter = heapStats()

  // 9. Optional teardown
  scenario.teardown?.()

  // 10. Sort latencies in-place and compute percentiles in microseconds
  latencies.sort()
  const p50Us = +(latencies[Math.floor(iterations * 0.50)]! / 1000).toFixed(2)
  const p99Us = +(latencies[Math.floor(iterations * 0.99)]! / 1000).toFixed(2)

  // 11. Build and return result
  return {
    name: scenario.name,
    opsPerSec: Math.round((iterations / elapsed) * 1e9),
    heapObjectsBefore: heapBefore.objectCount,
    heapObjectsAfter: heapAfter.objectCount,
    heapObjectsDelta: heapAfter.objectCount - heapBefore.objectCount,
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
  const COL_HEAP_MB = 9
  const COL_RSS = 9
  const COL_P50 = 9
  const COL_P99 = 9

  function pad(s: string, n: number, right = false): string {
    return right ? s.padStart(n) : s.padEnd(n)
  }

  const header = [
    pad('name', COL_NAME),
    pad('ops/s', COL_OPS, true),
    pad('heapΔ', COL_HEAP_DELTA, true),
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
      pad(r.heapSizeMB.toFixed(2), COL_HEAP_MB, true),
      pad(r.rssMB.toFixed(2), COL_RSS, true),
      pad(r.p50Us.toFixed(2), COL_P50, true),
      pad(r.p99Us.toFixed(2), COL_P99, true),
    ].join('  '),
  )

  return [header, sep, ...rows].join('\n')
}
