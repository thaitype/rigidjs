import { struct, slab, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B2-small-scale — Insert+remove churn at small N: 10, 100, 1000 ops/frame
// Key metric: opsPerSec, p99Us
//
// Measures churn throughput at scales most favorable to JS objects:
// small working sets fit in JIT nursery; GC pressure is minimal.
//
// Per frame: insert N entities, then remove all N (100 frames).
// Container is pre-filled to N capacity before churning begins.
//
// Three variants:
//   JS baseline:     push + pop on array with LIFO free-list (mirrors slab layout)
//   RigidJS slab:    insert + remove
//   RigidJS vec:     push + swapRemove
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

function makeJsBaseline(n: number): Scenario {
  let jsPool: Array<{ x: number; y: number; z: number } | null> = []
  let jsFree: number[] = []

  return {
    name: `B2-small JS N=${n}`,
    setup() {
      jsPool = new Array(n).fill(null)
      jsFree = Array.from({ length: n }, (_, i) => n - 1 - i)
    },
    fn() {
      // One "frame": insert N objects, then remove all N
      for (let i = 0; i < n; i++) {
        const slot = jsFree.pop()!
        jsPool[slot] = { x: i, y: i, z: 0 }
      }
      for (let i = 0; i < n; i++) {
        jsPool[i] = null
        jsFree.push(i)
      }
    },
    iterations: 100,
    warmup: 10,
  }
}

function makeSlabScenario(n: number): Scenario {
  // Pre-sized slot capture array — no .push() inside fn
  const slots = new Int32Array(n)
  let rigidSlab = slab(Vec3, n)

  return {
    name: `B2-small RigidJS slab N=${n}`,
    setup() {
      rigidSlab = slab(Vec3, n)
    },
    fn() {
      // One "frame": insert N, then remove all N
      for (let i = 0; i < n; i++) {
        const h = rigidSlab.insert()
        h.x = i
        h.y = i
        h.z = 0
        slots[i] = h.slot
      }
      for (let i = 0; i < n; i++) {
        rigidSlab.remove(slots[i]!)
      }
    },
    teardown() {
      rigidSlab.drop()
    },
    iterations: 100,
    warmup: 10,
  }
}

function makeVecScenario(n: number): Scenario {
  let rigidVec = vec(Vec3, n)

  return {
    name: `B2-small RigidJS vec N=${n}`,
    setup() {
      // Pre-fill vec to half capacity so push/swapRemove churns within bounds
      rigidVec = vec(Vec3, n)
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

export const b2SmallScenarios: Scenario[] = COUNTS.flatMap((n) => [
  makeJsBaseline(n),
  makeSlabScenario(n),
  makeVecScenario(n),
])
