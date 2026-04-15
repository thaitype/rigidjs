import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3-small-scale — Iteration at small N: 10, 100, 1000 entities
// Key metric: opsPerSec
//
// Tests pos.x += vel.x pattern at scales where JS object access is most
// optimized: hidden classes stable, GC nursery pressure negligible.
//
// Three access strategies:
//   JS baseline:        for loop over plain object array
//   RigidJS vec indexed: vec.get(i) handle loop
//   RigidJS vec column: TypedArray direct column access
//
// Container is pre-filled in setup() so iteration is the only hot cost.
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3 })

function makeJsBaseline(n: number): Scenario {
  let jsArr: Array<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }> = []

  return {
    name: `B3-small JS N=${n}`,
    setup() {
      jsArr = new Array(n)
      for (let i = 0; i < n; i++) {
        jsArr[i] = { pos: { x: i, y: 0, z: 0 }, vel: { x: 1, y: 0, z: 0 } }
      }
    },
    fn() {
      for (let i = 0; i < jsArr.length; i++) {
        const o = jsArr[i]!
        o.pos.x += o.vel.x
      }
    },
    iterations: 10_000,
    warmup: 1_000,
  }
}

function makeVecGetScenario(n: number): Scenario {
  let rigidVec = vec(Particle, n)

  return {
    name: `B3-small RigidJS vec indexed N=${n}`,
    setup() {
      rigidVec = vec(Particle, n)
      for (let i = 0; i < n; i++) {
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
      for (let i = 0; i < rigidVec.len; i++) {
        const h = rigidVec.get(i)
        h.pos.x += h.vel.x
      }
    },
    teardown() {
      rigidVec.drop()
    },
    iterations: 10_000,
    warmup: 1_000,
  }
}

function makeVecColumnScenario(n: number): Scenario {
  let rigidVec = vec(Particle, n)
  let posX: Float64Array = rigidVec.column('pos.x')
  let velX: Float64Array = rigidVec.column('vel.x')

  return {
    name: `B3-small RigidJS vec column N=${n}`,
    setup() {
      rigidVec = vec(Particle, n)
      for (let i = 0; i < n; i++) {
        const h = rigidVec.push()
        h.pos.x = i
        h.pos.y = 0
        h.pos.z = 0
        h.vel.x = 1
        h.vel.y = 0
        h.vel.z = 0
      }
      posX = rigidVec.column('pos.x')
      velX = rigidVec.column('vel.x')
    },
    fn() {
      const len = rigidVec.len
      for (let i = 0; i < len; i++) {
        posX[i] = posX[i]! + velX[i]!
      }
    },
    teardown() {
      rigidVec.drop()
    },
    iterations: 10_000,
    warmup: 1_000,
  }
}

const COUNTS = [10, 100, 1_000]

export const b3SmallScenarios: Scenario[] = COUNTS.flatMap((n) => [
  makeJsBaseline(n),
  makeVecGetScenario(n),
  makeVecColumnScenario(n),
])
