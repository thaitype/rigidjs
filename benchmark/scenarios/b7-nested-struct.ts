import { struct, slab } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B7 — Nested struct: 50k Particle-like entities
// Key metrics: heapObjectsDelta, heapSizeMB, rssMB
//
// Three runs:
//   b7JsNestedBaseline  — nested JS objects { pos: {x,y,z}, vel: {x,y,z}, life, id }
//   b7JsFlatBaseline    — flattened JS objects { posX, posY, posZ, velX, velY, velZ, life, id }
//   b7RigidJs           — RigidJS nested struct (pos: Vec3, vel: Vec3, life: f32, id: u32)
//
// Two JS baselines let readers see whether flattening alone closes the gap,
// or if RigidJS still wins on heapObjectsDelta + memory even vs flat JS.
// ---------------------------------------------------------------------------

const b7JsNestedBaseline: Scenario = {
  name: 'B7 JS nested (50k {pos:{x,y,z},vel:{x,y,z},life,id})',
  setup() {
    // no-op — each fn() call allocates fresh
  },
  fn() {
    const arr: Array<{
      pos: { x: number; y: number; z: number }
      vel: { x: number; y: number; z: number }
      life: number
      id: number
    }> = new Array(50_000)
    for (let i = 0; i < 50_000; i++) {
      arr[i] = {
        pos: { x: i * 0.1, y: i * 0.2, z: i * 0.3 },
        vel: { x: 1, y: 0, z: 0 },
        life: 1,
        id: i,
      }
    }
  },
  iterations: 10,
  warmup: 2,
}

const b7JsFlatBaseline: Scenario = {
  name: 'B7 JS flat (50k {posX,posY,posZ,...,life,id})',
  setup() {
    // no-op — each fn() call allocates fresh
  },
  fn() {
    const arr: Array<{
      posX: number
      posY: number
      posZ: number
      velX: number
      velY: number
      velZ: number
      life: number
      id: number
    }> = new Array(50_000)
    for (let i = 0; i < 50_000; i++) {
      arr[i] = {
        posX: i * 0.1,
        posY: i * 0.2,
        posZ: i * 0.3,
        velX: 1,
        velY: 0,
        velZ: 0,
        life: 1,
        id: i,
      }
    }
  },
  iterations: 10,
  warmup: 2,
}

const b7RigidJs: Scenario = {
  name: 'B7 RigidJS nested struct (50k Particle slab)',
  setup() {
    // no-op — each fn() call creates and drops
  },
  fn() {
    const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
    const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })
    const s = slab(Particle, 50_000)
    for (let i = 0; i < 50_000; i++) {
      const h = s.insert()
      h.pos.x = i * 0.1
      h.pos.y = i * 0.2
      h.pos.z = i * 0.3
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
      h.life = 1
      h.id = i
    }
    s.drop()
  },
  iterations: 10,
  warmup: 2,
}

export const b7Scenarios: Scenario[] = [b7JsNestedBaseline, b7JsFlatBaseline, b7RigidJs]
