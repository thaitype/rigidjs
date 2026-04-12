import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B2-vec — Vec push/swapRemove churn: 10k operations per frame
// Key metrics: ops/s, p99 latency
//
// Mirrors B2 (slab insert/remove) but uses vec with swapRemove.
// swapRemove is the O(1) hot-path removal — it swaps the target with the
// last element and decrements len. No slot map or bitmap needed.
//
// Strategy per frame:
//   1. Push N/2 entities into the vec (filling from half-full state).
//   2. swapRemove the first N/2 elements (brings back to half-full).
//
// Starting state: vec pre-filled to 5k entities (half of 10k churn budget).
// This matches the B2 slab pattern: churn within a populated container.
//
// JS baseline uses the same pool-with-LIFO-freelist as B2 for fair comparison.
// ---------------------------------------------------------------------------

const CHURN_N = 10_000

// JS state
let jsPool: Array<{ x: number; y: number; z: number } | null> = []
let jsFree: number[] = []

const b2VecJsBaseline: Scenario = {
  name: 'B2-vec JS baseline (10k push/splice churn)',
  setup() {
    jsPool = new Array(CHURN_N).fill(null)
    jsFree = Array.from({ length: CHURN_N }, (_, i) => CHURN_N - 1 - i)
  },
  fn() {
    // One frame: push CHURN_N/2 then remove all CHURN_N/2
    const half = CHURN_N / 2
    for (let i = 0; i < half; i++) {
      const slot = jsFree.pop()!
      jsPool[slot] = { x: i, y: i, z: 0 }
    }
    for (let i = 0; i < half; i++) {
      jsPool[i] = null
      jsFree.push(i)
    }
  },
  iterations: 100,
  warmup: 10,
}

// RigidJS vec state
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
let rigidVec = vec(Vec3, CHURN_N)

const b2VecRigidJs: Scenario = {
  name: 'B2-vec RigidJS vec (10k push+swapRemove/frame)',
  setup() {
    // Start with a vec at half capacity (5k entities)
    rigidVec = vec(Vec3, CHURN_N)
    const half = CHURN_N / 2
    for (let i = 0; i < half; i++) {
      const h = rigidVec.push()
      h.x = i
      h.y = i
      h.z = 0
    }
  },
  fn() {
    const half = CHURN_N / 2
    // Push half: fills vec from 5k to 10k
    for (let i = 0; i < half; i++) {
      const h = rigidVec.push()
      h.x = i
      h.y = i
      h.z = 0
    }
    // swapRemove from front: removes half elements via O(1) swap
    // Each swapRemove(0) swaps element 0 with the last element and shrinks len.
    // After half swapRemove(0)s we are back to 5k.
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

export const b2VecScenarios: Scenario[] = [b2VecJsBaseline, b2VecRigidJs]
