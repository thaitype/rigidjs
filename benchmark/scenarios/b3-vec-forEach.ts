import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3-vec-forEach — Iterate 100k entities via vec.forEach() with handle field access
// Key metric: ops/s
//
// Same workload as B3-vec-handle (100k pos.x += vel.x) but uses the internal
// forEach(cb) method instead of the for..of iterator protocol.
// forEach uses a plain counted loop with no iterator object overhead.
//
// JS baseline: same as B3 (iterate array of plain JS objects with pos/vel).
// ---------------------------------------------------------------------------

const N = 100_000

// JS state — built once in setup, mutated each frame
let jsArr: Array<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }> = []

const b3VecForEachJsBaseline: Scenario = {
  name: 'B3-vec-forEach JS baseline (100k pos.x += vel.x)',
  setup() {
    jsArr = new Array(N)
    for (let i = 0; i < N; i++) {
      jsArr[i] = { pos: { x: i, y: 0, z: 0 }, vel: { x: 1, y: 0, z: 0 } }
    }
  },
  fn() {
    for (let i = 0; i < jsArr.length; i++) {
      const o = jsArr[i]!
      o.pos.x += o.vel.x
    }
  },
  iterations: 100,
  warmup: 10,
}

// RigidJS vec state — built once in setup
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3 })
let rigidVec = vec(Particle, N)

const b3VecForEachRigidJs: Scenario = {
  name: 'B3-vec-forEach RigidJS vec (100k forEach h.pos.x += h.vel.x)',
  setup() {
    rigidVec = vec(Particle, N)
    for (let i = 0; i < N; i++) {
      const h = rigidVec.push()
      h.pos.x = i
      h.pos.y = 0
      h.pos.z = 0
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
    }
  },
  fn() {
    // forEach uses an internal counted loop — no iterator protocol overhead.
    // The shared handle is rebased to each index. Zero allocations in the hot path.
    rigidVec.forEach((h) => {
      h.pos.x += h.vel.x
    })
  },
  teardown() {
    rigidVec.drop()
  },
  iterations: 100,
  warmup: 10,
}

export const b3VecForEachScenarios: Scenario[] = [b3VecForEachJsBaseline, b3VecForEachRigidJs]
