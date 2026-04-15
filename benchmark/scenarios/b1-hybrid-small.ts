import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B1-hybrid-small — Creation at small N: 10, 100, 1000 entities
// Using vec(def) — hybrid mode, starts in JS mode, no pre-allocated capacity.
//
// Key metric: opsPerSec, heapObjectsDelta
//
// Validates that hybrid vec in JS mode matches plain JS creation speed.
// Compare against B1-small JS N= baselines for ratio calculation.
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

function makeJsBaseline(n: number): Scenario {
  return {
    name: `B1-hybrid JS N=${n}`,
    setup() {
      // no-op
    },
    fn() {
      const arr: { x: number; y: number; z: number }[] = new Array(n)
      for (let i = 0; i < n; i++) {
        arr[i] = { x: i, y: i, z: i }
      }
    },
    allocate(): unknown {
      const arr = new Array<{ x: number; y: number; z: number }>(n)
      for (let i = 0; i < n; i++) {
        arr[i] = { x: i, y: i, z: i }
      }
      return arr
    },
    iterations: 1_000,
    warmup: 100,
  }
}

function makeHybridVecScenario(n: number): Scenario {
  return {
    name: `B1-hybrid RigidJS vec N=${n}`,
    setup() {
      // no-op
    },
    fn() {
      // vec(def) — no capacity — starts in JS mode
      const v = vec(Vec3)
      for (let i = 0; i < n; i++) {
        const h = v.push()
        h.x = i
        h.y = i
        h.z = i
      }
      v.drop()
    },
    allocate(): unknown {
      const v = vec(Vec3)
      for (let i = 0; i < n; i++) {
        const h = v.push()
        h.x = i
        h.y = i
        h.z = i
      }
      // Keep live for heapAfter sample — harness drops reference after sampling
      return v
    },
    iterations: 1_000,
    warmup: 100,
  }
}

// Only N <= 100 stay in JS mode throughout (threshold is 128).
// N=1000 will trigger graduation at N=128, measuring hybrid auto-graduate scenario.
const COUNTS = [10, 100, 1_000]

export const b1HybridScenarios: Scenario[] = COUNTS.flatMap((n) => [
  makeJsBaseline(n),
  makeHybridVecScenario(n),
])
