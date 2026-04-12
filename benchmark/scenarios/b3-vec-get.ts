import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3-vec-get — Iterate 100k entities via plain indexed loop with vec.get(i)
// Key metric: ops/s
//
// This is the "receipts" scenario: can vec beat slab on an indexed access
// pattern when the iterator protocol overhead is removed?
//
// JS baseline: same as B3 (iterate array of plain JS objects, pos.x += vel.x)
// RigidJS vec:  for (let i = 0; i < v.len; i++) { const h = v.get(i); h.pos.x += h.vel.x }
// No for..of, no iterator protocol — just plain indexed get().
// ---------------------------------------------------------------------------

const N = 100_000

// JS state — built once in setup, mutated each frame
let jsArr: Array<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }> = []

const b3VecGetJsBaseline: Scenario = {
  name: 'B3-vec-get JS baseline (100k pos.x += vel.x)',
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
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })
let rigidVec = vec(Particle, N)

const b3VecGetRigidJs: Scenario = {
  name: 'B3-vec-get RigidJS vec (100k indexed get h.pos.x += h.vel.x)',
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
      h.life = 1.0
      h.id = i
    }
  },
  fn() {
    // Plain indexed loop — no iterator protocol, no for..of overhead.
    // vec.get(i) returns a handle rebased to slot i.
    for (let i = 0; i < rigidVec.len; i++) {
      const h = rigidVec.get(i)
      h.pos.x += h.vel.x
    }
  },
  teardown() {
    rigidVec.drop()
  },
  iterations: 100,
  warmup: 10,
}

export const b3VecGetScenarios: Scenario[] = [b3VecGetJsBaseline, b3VecGetRigidJs]
