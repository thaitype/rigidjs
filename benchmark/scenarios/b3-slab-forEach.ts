import { struct, slab } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3-slab-forEach — Iterate 100k entities via slab.forEach() with handle field access
// Key metric: ops/s
//
// Same workload as B3-iterate-mutate (100k pos.x += vel.x) but uses the internal
// forEach(cb) method instead of the manual for+has+get loop.
// forEach uses a plain counted loop with bitmap occupancy check, skipping holes,
// and rebasing the shared handle. Zero per-call allocations.
//
// JS baseline: same as B3 (iterate array of plain JS objects with pos/vel).
// ---------------------------------------------------------------------------

const N = 100_000

// JS state — built once in setup, mutated each frame
let jsArr: Array<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }> = []

const b3SlabForEachJsBaseline: Scenario = {
  name: 'B3-slab-forEach JS baseline (100k pos.x += vel.x)',
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

// RigidJS slab state — built once in setup
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3 })
let rigidSlab = slab(Particle, N)

const b3SlabForEachRigidJs: Scenario = {
  name: 'B3-slab-forEach RigidJS slab (100k forEach h.pos.x += h.vel.x)',
  setup() {
    rigidSlab = slab(Particle, N)
    for (let i = 0; i < N; i++) {
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
    // forEach uses an internal counted loop with bitmap check for occupancy.
    // No manual has()+get() needed — forEach handles the skip internally.
    // The shared handle is rebased to each occupied slot. Zero per-call allocations.
    rigidSlab.forEach((h) => {
      h.pos.x += h.vel.x
    })
  },
  teardown() {
    rigidSlab.drop()
  },
  iterations: 100,
  warmup: 10,
}

export const b3SlabForEachScenarios: Scenario[] = [b3SlabForEachJsBaseline, b3SlabForEachRigidJs]
