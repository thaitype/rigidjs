import { struct, slab } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B2 — Insert/remove churn: 100 frames of 10k insert + 10k remove
// Key metric: p99Us
//
// JS baseline uses a pre-sized Array<T | null> with a LIFO free-list,
// mirroring slab's internal structure so the delta reflects object layout
// (hidden class + GC tracking) rather than algorithmic differences.
// ---------------------------------------------------------------------------

// Module-level state shared between setup and fn (reset by setup each run).
let jsPool: Array<{ x: number; y: number; z: number } | null> = []
let jsFree: number[] = []

const b2JsBaseline: Scenario = {
  name: 'B2 JS baseline (10k insert+remove/frame)',
  setup() {
    jsPool = new Array(10_000).fill(null)
    jsFree = Array.from({ length: 10_000 }, (_, i) => 10_000 - 1 - i)
  },
  fn() {
    // One "frame" — insert 10k objects, then remove all 10k
    for (let i = 0; i < 10_000; i++) {
      const slot = jsFree.pop()!
      jsPool[slot] = { x: i, y: i, z: 0 }
    }
    for (let i = 0; i < 10_000; i++) {
      jsPool[i] = null
      jsFree.push(i)
    }
  },
  iterations: 100,
  warmup: 10,
}

// RigidJS state — initialized once in setup, reused across frames
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
// Pre-sized slot capture array — no .push() inside fn
const slots = new Int32Array(10_000)
let rigidSlab = slab(Vec3, 10_000)

const b2RigidJs: Scenario = {
  name: 'B2 RigidJS slab (10k insert+remove/frame)',
  setup() {
    rigidSlab = slab(Vec3, 10_000)
  },
  fn() {
    // One "frame" — insert 10k, then remove all 10k
    for (let i = 0; i < 10_000; i++) {
      const h = rigidSlab.insert()
      h.x = i
      h.y = i
      h.z = 0
      slots[i] = h.slot
    }
    for (let i = 0; i < 10_000; i++) {
      rigidSlab.remove(slots[i]!)
    }
  },
  teardown() {
    rigidSlab.drop()
  },
  iterations: 100,
  warmup: 10,
}

export const b2Scenarios: Scenario[] = [b2JsBaseline, b2RigidJs]
