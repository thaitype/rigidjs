import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3-vec-handle — Iterate 100k entities via for..of vec with handle field access
// Key metric: ops/s
//
// Mirrors B3 (slab handle) but uses vec instead of slab. The vec iterator
// yields a shared handle rebased to each index 0..len-1. No has() check is
// needed — vec is dense and every slot 0..len-1 is occupied.
//
// JS baseline: same as B3 (iterate array of plain JS objects with pos/vel).
// ---------------------------------------------------------------------------

const N = 100_000

// JS state — built once in setup, mutated each frame
let jsArr: Array<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }> = []

const b3VecJsBaseline: Scenario = {
  name: 'B3-vec-handle JS baseline (100k pos.x += vel.x)',
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

const b3VecHandleRigidJs: Scenario = {
  name: 'B3-vec-handle RigidJS vec (100k for..of h.pos.x += h.vel.x)',
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
    // for..of iterates 0..len-1 — no has() check needed; vec is always dense.
    // The iterator yields the same shared handle instance each time, rebased to
    // the current index. Zero iterator allocations in the hot path.
    for (const h of rigidVec) {
      h.pos.x += h.vel.x
    }
  },
  teardown() {
    rigidVec.drop()
  },
  iterations: 100,
  warmup: 10,
}

export const b3VecHandleScenarios: Scenario[] = [b3VecJsBaseline, b3VecHandleRigidJs]
