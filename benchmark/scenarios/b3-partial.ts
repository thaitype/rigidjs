import { struct, slab, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3-partial — Iterate a 50%-full container: slab vs vec vs JS
// Key metric: ops/s
//
// This scenario demonstrates vec's dense-packing advantage over slab when
// the slab has holes. Both containers hold exactly 100k live entities, but:
//
//   - Slab: capacity 200k, 100k entities inserted (50% full). The slab
//     iterator visits all 200k slots and calls has() for each — half are
//     holes that must be skipped.
//   - Vec: capacity = 100k (len = 100k), 100% packed. The for..of iterator
//     visits exactly 100k slots with no has() check and no holes to skip.
//   - JS baseline: plain Array of 100k objects (dense, no gaps).
//
// With the same number of live entities, vec should win by a significant
// margin because it visits exactly N slots while slab visits 2N slots and
// does a has() check on each.
// ---------------------------------------------------------------------------

const LIVE_ENTITIES = 100_000
const SLAB_CAPACITY = 200_000  // 50% full

// JS baseline state
let jsArr: Array<{ pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }> = []

const b3PartialJsBaseline: Scenario = {
  name: 'B3-partial JS baseline (100k dense array)',
  setup() {
    jsArr = new Array(LIVE_ENTITIES)
    for (let i = 0; i < LIVE_ENTITIES; i++) {
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

// Slab: 50%-full (200k capacity, 100k entities)
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3 })
let rigidSlab = slab(Particle, SLAB_CAPACITY)

const b3PartialSlabRigidJs: Scenario = {
  name: 'B3-partial RigidJS slab (50%-full, 100k live / 200k slots)',
  setup() {
    rigidSlab = slab(Particle, SLAB_CAPACITY)
    // Insert LIVE_ENTITIES entities — slab is now 50% full
    for (let i = 0; i < LIVE_ENTITIES; i++) {
      const h = rigidSlab.insert()
      h.pos.x = i
      h.pos.y = 0
      h.pos.z = 0
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
    }
    // No removals — entities occupy the first LIVE_ENTITIES slots (no holes).
    // The other LIVE_ENTITIES slots are empty. Iterator must check has() for all.
  },
  fn() {
    // Visit all 200k slots, skip empty ones via has(). This is the standard
    // slab iteration pattern — correct and representative.
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

// Vec: 100%-packed (len = 100k, capacity = 100k)
let rigidVec = vec(Particle, LIVE_ENTITIES)

const b3PartialVecRigidJs: Scenario = {
  name: 'B3-partial RigidJS vec (100%-packed, 100k len)',
  setup() {
    rigidVec = vec(Particle, LIVE_ENTITIES)
    // Push exactly LIVE_ENTITIES — vec is 100% packed, len == capacity
    for (let i = 0; i < LIVE_ENTITIES; i++) {
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
    // for..of visits exactly len (100k) slots — no holes, no has() check.
    // This is the key advantage: vec visits N slots for N live entities,
    // while slab visits 2N slots for the same N live entities.
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

export const b3PartialScenarios: Scenario[] = [b3PartialJsBaseline, b3PartialSlabRigidJs, b3PartialVecRigidJs]
