import { struct, slab } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B1 — Struct creation: 100k entities
// Key metric: heapObjectsDelta, allocationDelta
// ---------------------------------------------------------------------------

const b1JsBaseline: Scenario = {
  name: 'B1 JS baseline (100k {x,y,z} alloc)',
  setup() {
    // no-op
  },
  fn() {
    const arr: { x: number; y: number; z: number }[] = new Array(100_000)
    for (let i = 0; i < 100_000; i++) {
      arr[i] = { x: i, y: i, z: i }
    }
  },
  allocate(): unknown {
    const arr = new Array<{ x: number; y: number; z: number }>(100_000)
    for (let i = 0; i < 100_000; i++) {
      arr[i] = { x: i, y: i, z: i }
    }
    return arr
  },
  iterations: 10,
  warmup: 2,
}

const b1RigidJs: Scenario = {
  name: 'B1 RigidJS slab (100k inserts)',
  setup() {
    // no-op
  },
  fn() {
    const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
    const s = slab(Vec3, 100_000)
    for (let i = 0; i < 100_000; i++) {
      const h = s.insert()
      h.x = i
      h.y = i
      h.z = i
    }
    s.drop()
  },
  allocate(): unknown {
    const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
    const s = slab(Vec3, 100_000)
    for (let i = 0; i < 100_000; i++) {
      const h = s.insert()
      h.x = i
      h.y = i
      h.z = i
    }
    // Do NOT call s.drop() here — harness needs the slab live for heapAfter sample.
    // The harness releases the reference via retained = null, after which the
    // backing ArrayBuffer becomes collectable.
    return s
  },
  iterations: 10,
  warmup: 2,
}

export const b1Scenarios: Scenario[] = [b1JsBaseline, b1RigidJs]
