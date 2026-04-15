import { struct, slab, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B1-small-scale — Creation at small N: 10, 100, 1000 entities
// Key metric: opsPerSec, heapObjectsDelta
//
// Measures creation overhead at scales where JS objects are most optimized
// by the JIT (hidden classes fully monomorphic, GC nursery pressure low).
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

function makeJsBaseline(n: number): Scenario {
  return {
    name: `B1-small JS N=${n}`,
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

function makeSlabScenario(n: number): Scenario {
  return {
    name: `B1-small RigidJS slab N=${n}`,
    setup() {
      // no-op
    },
    fn() {
      const s = slab(Vec3, n)
      for (let i = 0; i < n; i++) {
        const h = s.insert()
        h.x = i
        h.y = i
        h.z = i
      }
      s.drop()
    },
    allocate(): unknown {
      const s = slab(Vec3, n)
      for (let i = 0; i < n; i++) {
        const h = s.insert()
        h.x = i
        h.y = i
        h.z = i
      }
      // Keep live for heapAfter sample — harness drops reference after sampling
      return s
    },
    iterations: 1_000,
    warmup: 100,
  }
}

function makeVecScenario(n: number): Scenario {
  return {
    name: `B1-small RigidJS vec N=${n}`,
    setup() {
      // no-op
    },
    fn() {
      const v = vec(Vec3, n)
      for (let i = 0; i < n; i++) {
        const h = v.push()
        h.x = i
        h.y = i
        h.z = i
      }
      v.drop()
    },
    allocate(): unknown {
      const v = vec(Vec3, n)
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

const COUNTS = [10, 100, 1_000]

export const b1SmallScenarios: Scenario[] = COUNTS.flatMap((n) => [
  makeJsBaseline(n),
  makeSlabScenario(n),
  makeVecScenario(n),
])
