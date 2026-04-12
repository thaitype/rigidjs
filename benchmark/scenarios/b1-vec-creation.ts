import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B1-vec — Vec creation: push 100k entities
// Key metrics: ops/s, heapObjectsDelta
//
// Mirrors B1 (slab) but uses vec instead of slab. The vec grows from a
// default initial capacity via 2x doubling until 100k entities are pushed.
// ---------------------------------------------------------------------------

const b1VecJsBaseline: Scenario = {
  name: 'B1-vec JS baseline (100k {x,y,z} alloc)',
  setup() {
    // no-op — reuse same definition as B1
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

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

const b1VecRigidJs: Scenario = {
  name: 'B1-vec RigidJS vec (100k push)',
  setup() {
    // no-op
  },
  fn() {
    // Start with a small initial capacity to exercise growth path
    const v = vec(Vec3, 16)
    for (let i = 0; i < 100_000; i++) {
      const h = v.push()
      h.x = i
      h.y = i
      h.z = i
    }
    v.drop()
  },
  allocate(): unknown {
    const v = vec(Vec3, 16)
    for (let i = 0; i < 100_000; i++) {
      const h = v.push()
      h.x = i
      h.y = i
      h.z = i
    }
    // Do NOT drop here — keep live for heapAfter sample
    return v
  },
  iterations: 10,
  warmup: 2,
}

export const b1VecScenarios: Scenario[] = [b1VecJsBaseline, b1VecRigidJs]
