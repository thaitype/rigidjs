import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B2-hybrid-small — Insert+remove churn at small N: 10, 100, 1000 ops/frame
// Using vec(def) — hybrid mode, starts in JS mode (N=10, 100 stay in JS mode;
// N=1000 will graduate during setup pre-fill).
//
// Key metric: opsPerSec, p99Us
//
// Validates that hybrid vec churn in JS mode matches plain JS speed.
// Per frame: push half-N, swapRemove half-N.
// Container is pre-filled to half-N before churning begins.
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

function makeJsBaseline(n: number): Scenario {
  let jsArr: Array<{ x: number; y: number; z: number }> = []

  return {
    name: `B2-hybrid JS N=${n}`,
    setup() {
      jsArr = []
      const half = Math.floor(n / 2)
      for (let i = 0; i < half; i++) {
        jsArr.push({ x: i, y: i, z: 0 })
      }
    },
    fn() {
      const half = Math.floor(n / 2)
      // Push half
      for (let i = 0; i < half; i++) {
        jsArr.push({ x: i, y: i, z: 0 })
      }
      // Remove (swap-remove style) from front: back to half-full
      for (let i = 0; i < half; i++) {
        const last = jsArr.pop()!
        if (jsArr.length > 0) {
          jsArr[0] = last
        }
      }
    },
    iterations: 100,
    warmup: 10,
  }
}

function makeHybridVecScenario(n: number): Scenario {
  // vec(def) — no capacity — starts in JS mode
  let rigidVec = vec(Vec3)

  return {
    name: `B2-hybrid RigidJS vec N=${n}`,
    setup() {
      // Re-create without capacity — starts in JS mode
      rigidVec = vec(Vec3)
      const half = Math.floor(n / 2)
      for (let i = 0; i < half; i++) {
        const h = rigidVec.push()
        h.x = i
        h.y = i
        h.z = 0
      }
    },
    fn() {
      const half = Math.floor(n / 2)
      // Push half: fills from half-full to full
      for (let i = 0; i < half; i++) {
        const h = rigidVec.push()
        h.x = i
        h.y = i
        h.z = 0
      }
      // swapRemove from front: back to half-full
      for (let i = 0; i < half; i++) {
        rigidVec.swapRemove(0)
      }
    },
    teardown() {
      rigidVec.drop()
    },
    iterations: 100,
    warmup: 10,
  }
}

const COUNTS = [10, 100, 1_000]

export const b2HybridScenarios: Scenario[] = COUNTS.flatMap((n) => [
  makeJsBaseline(n),
  makeHybridVecScenario(n),
])
