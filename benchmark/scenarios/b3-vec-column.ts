import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3-vec-column — Iterate 100k entities via vec.column() direct TypedArray
// Key metric: ops/s
//
// Mirrors B3-column (slab) but uses vec instead of slab. Column refs are
// resolved once in setup(), then the hot loop is a pure TypedArray indexed
// loop over vec.len elements. No handle. No slot check. This is the maximum
// throughput tier of vec access.
//
// JS baseline: same as B3 (iterate array of plain JS objects).
// ---------------------------------------------------------------------------

const N = 100_000

// JS state — built once in setup
let jsArr: Array<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }> = []

const b3VecColumnJsBaseline: Scenario = {
  name: 'B3-vec-column JS baseline (100k pos.x += vel.x)',
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
// Column refs resolved once in setup — hot loop reads them as module-scoped refs.
let posX: Float64Array = rigidVec.column('pos.x')
let velX: Float64Array = rigidVec.column('vel.x')

const b3VecColumnRigidJs: Scenario = {
  name: 'B3-vec-column RigidJS vec (100k column posX[i] += velX[i])',
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
    // Resolve column refs ONCE here. The hot loop reads them as plain
    // module-scoped Float64Array refs — no Map lookup, no method call.
    // IMPORTANT: column refs are stable as long as the vec does not grow.
    // Since we pushed exactly N into a capacity-N vec, no growth occurs.
    posX = rigidVec.column('pos.x')
    velX = rigidVec.column('vel.x')
  },
  fn() {
    // Pure TypedArray indexed-access loop. No has() check. No handle dispatch.
    // vec is densely packed, so every 0..len-1 is a live entity.
    const len = rigidVec.len
    for (let i = 0; i < len; i++) {
      posX[i] = posX[i]! + velX[i]!
    }
  },
  teardown() {
    rigidVec.drop()
  },
  iterations: 100,
  warmup: 10,
}

export const b3VecColumnScenarios: Scenario[] = [b3VecColumnJsBaseline, b3VecColumnRigidJs]
