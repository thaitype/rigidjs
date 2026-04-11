import { struct, slab } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3 — Iteration + mutate: 100 full sweeps of 100k entities
// Key metric: opsPerSec
//
// JS baseline uses a flat Array<object> — the idiomatic perf-aware JS choice
// for dense iteration.
// ---------------------------------------------------------------------------

// JS state — built once in setup, mutated each frame
let jsArr: Array<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }> = []

const b3JsBaseline: Scenario = {
  name: 'B3 JS baseline (100k pos.x += vel.x)',
  setup() {
    jsArr = new Array(100_000)
    for (let i = 0; i < 100_000; i++) {
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

// RigidJS state — built once in setup
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3 })
let rigidSlab = slab(Particle, 100_000)

const b3RigidJs: Scenario = {
  name: 'B3 RigidJS slab (100k h.pos.x += h.vel.x)',
  setup() {
    rigidSlab = slab(Particle, 100_000)
    for (let i = 0; i < 100_000; i++) {
      const h = rigidSlab.insert()
      h.pos.x = i
      h.pos.y = 0
      h.pos.z = 0
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
    }
  },
  fn() {
    for (let i = 0; i < rigidSlab.capacity; i++) {
      if (!rigidSlab.has(i)) continue
      const h = rigidSlab.get(i)
      h.pos.x += h.vel.x
    }
  },
  teardown() {
    rigidSlab.drop()
  },
  iterations: 100,
  warmup: 10,
}

export const b3Scenarios: Scenario[] = [b3JsBaseline, b3RigidJs]
