import { mkdir } from 'node:fs/promises'
import { runAll, formatTable } from './harness.js'
import type { BenchResult } from './harness.js'
import { b1Scenarios } from './scenarios/b1-struct-creation.js'
import { b2Scenarios } from './scenarios/b2-insert-remove-churn.js'
import { b3Scenarios } from './scenarios/b3-iterate-mutate.js'
import { b7Scenarios } from './scenarios/b7-nested-struct.js'

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

function mdTable(rows: BenchResult[]): string {
  const header = '| name | ops/s | heapΔ | heapMB | rssMB | p50µs | p99µs |'
  const sep = '|------|-------|-------|--------|-------|-------|-------|'
  const dataRows = rows.map(
    (r) =>
      `| ${r.name} | ${r.opsPerSec.toLocaleString()} | ${r.heapObjectsDelta.toLocaleString()} | ${r.heapSizeMB.toFixed(2)} | ${r.rssMB.toFixed(2)} | ${r.p50Us.toFixed(2)} | ${r.p99Us.toFixed(2)} |`,
  )
  return [header, sep, ...dataRows].join('\n')
}

const b1Results = findResults(b1Scenarios.map((s) => s.name))
const b2Results = findResults(b2Scenarios.map((s) => s.name))
const b3Results = findResults(b3Scenarios.map((s) => s.name))
const b7Results = findResults(b7Scenarios.map((s) => s.name))

const b1JsDelta = b1Results[0]?.heapObjectsDelta ?? 0
const b1RigidDelta = b1Results[1]?.heapObjectsDelta ?? 0
const b2JsP99 = b2Results[0]?.p99Us ?? 0
const b2RigidP99 = b2Results[1]?.p99Us ?? 0
const b3JsOps = b3Results[0]?.opsPerSec ?? 0
const b3RigidOps = b3Results[1]?.opsPerSec ?? 0

const benchmarkMd = `# RigidJS Benchmark Report

**Bun version:** ${meta.bunVersion}
**Platform:** ${meta.platform} / ${meta.arch}
**Date:** ${meta.date}

---

## B1 — Struct creation

${mdTable(b1Results)}

B1 measures heap object pressure when creating 100,000 \`{x, y, z}\` entities. The JS baseline allocates one JS object per entity, resulting in a heapObjectsDelta of ~${b1JsDelta.toLocaleString()} tracked objects. RigidJS stores all data in a single pre-allocated ArrayBuffer, yielding a heapObjectsDelta of ~${b1RigidDelta.toLocaleString()}. The GC sees ${Math.abs(b1JsDelta - b1RigidDelta).toLocaleString()} fewer live objects, reducing scan and collection overhead in proportion to entity count.

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

B7 compares three strategies for 50,000 Particle-like entities with nested \`pos\` / \`vel\` vectors. The JS nested baseline allocates three JS objects per entity (parent + pos + vel), totalling ~150k GC-tracked objects. The JS flat baseline collapses these into one object per entity (~50k objects) — a manual optimization that many perf-aware JS developers already apply. RigidJS uses a single ArrayBuffer for all 50k entities, adding 0 GC-tracked objects beyond container bookkeeping. The heapObjectsDelta and heapSizeMB columns show how aggressively each approach loads the GC and RSS.

---

## Caveats

Single-run numbers are noisy and machine-dependent: JIT warmup state, OS scheduling, and GC timing all affect individual measurements. These benchmarks are reference data points, not statistically significant regressions gates. Scenarios B4 (filter chain via \`.iter()\`), B5 (temp allocation via \`bump()\`), and B6 (growable vec via \`vec()\`) are deferred until those primitives land in a future milestone — this suite intentionally covers only B1, B2, B3, and B7. Do not interpret the absence of B4/B5/B6 as evidence that RigidJS underperforms in those scenarios.

---

Machine-readable data: \`results.json\`
`

const benchmarkPath = `${reportDir}/benchmark.md`
await Bun.write(benchmarkPath, benchmarkMd)
console.log(`Report written to ${benchmarkPath}\n`)

process.exit(0)
