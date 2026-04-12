import { struct, vec } from '../../src/index.js'
import type { SustainedScenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B8-vec — Sustained churn (10s, 100k capacity, 1k churn/tick) using vec
// Key metrics: p99TickMs, p999TickMs, maxTickMs, stdDevTickMs
//
// Mirrors B8-slab but uses vec with push/swapRemove instead of slab insert/remove.
// swapRemove is O(1) — it swaps the target with the last element and decrements
// len. Because swapRemove changes element order, we track live entity indices
// in a FIFO ring buffer rather than the slab slot keys: the slot stored in the
// ring is the index into the vec AT THE TIME OF PUSH, not an identity key.
//
// IMPORTANT: swapRemove invalidates indices. We always remove the LAST element
// in the vec (pop) to avoid index invalidation, and enqueue new elements at the
// end. For fair comparison with B8-slab we still churn the same number of
// entities per tick (CHURN_PER_TICK pushes + CHURN_PER_TICK swapRemoves).
//
// The swapRemove target index is always 0 (front) — each tick removes the
// CHURN_PER_TICK elements that were conceptually "oldest" by swapping them
// with the back before decrementing len. This is the idiomatic vec churn
// pattern.
// ---------------------------------------------------------------------------

const DURATION_MS = 10_000
const CAPACITY = 100_000
const INITIAL_FILL = 50_000
const CHURN_PER_TICK = 1_000
const DT = 0.016

// ---------------------------------------------------------------------------
// JS baseline — mirrors B8 JS baseline exactly (array of objects + free-list)
// ---------------------------------------------------------------------------

interface Entity {
  pos: { x: number; y: number; z: number }
  vel: { x: number; y: number; z: number }
  life: number
  id: number
}

// JS baseline module-level state (reset by setup)
let jsStorage: Array<Entity | null> = []
let jsFreeTop = 0
let jsFreeList = new Int32Array(CAPACITY)
// FIFO queue for OLDEST-first removal: Int32Array ring buffer with head/tail
let jsFifoQueue = new Int32Array(CAPACITY)
let jsFifoHead = 0
let jsFifoTail = 0
let jsNextId = 0

function jsFifoEnqueue(slot: number): void {
  jsFifoQueue[jsFifoTail] = slot
  jsFifoTail = (jsFifoTail + 1) % CAPACITY
}

function jsFifoDequeue(): number {
  const slot = jsFifoQueue[jsFifoHead]!
  jsFifoHead = (jsFifoHead + 1) % CAPACITY
  return slot
}

export const b8VecJsBaseline: SustainedScenario = {
  name: 'B8-vec JS baseline (100k, 1k churn/tick, 10s)',
  durationMs: DURATION_MS,
  warmupTicks: 50,
  collectHeapTimeSeries: true,

  setup() {
    jsStorage = new Array<Entity | null>(CAPACITY).fill(null)

    jsFreeTop = 0
    jsFreeList = new Int32Array(CAPACITY)

    jsFifoQueue = new Int32Array(CAPACITY)
    jsFifoHead = 0
    jsFifoTail = 0
    jsNextId = 0

    // Pre-populate free-list with slots beyond INITIAL_FILL (high slots first, LIFO)
    for (let i = CAPACITY - 1; i >= INITIAL_FILL; i--) {
      jsFreeList[jsFreeTop++] = i
    }

    // Fill to INITIAL_FILL and seed FIFO queue with insertion order
    for (let i = 0; i < INITIAL_FILL; i++) {
      jsStorage[i] = {
        pos: { x: i * 0.1, y: 0, z: 0 },
        vel: { x: 1, y: 0, z: 0 },
        life: 1,
        id: jsNextId++,
      }
      jsFifoEnqueue(i)
    }
  },

  tick() {
    // Step 1: Insert CHURN_PER_TICK new entities
    for (let k = 0; k < CHURN_PER_TICK; k++) {
      const slot = jsFreeList[--jsFreeTop]!
      jsStorage[slot] = {
        pos: { x: slot * 0.1, y: 0, z: 0 },
        vel: { x: 1, y: 0, z: 0 },
        life: 1,
        id: jsNextId++,
      }
      jsFifoEnqueue(slot)
    }

    // Step 2: Remove CHURN_PER_TICK oldest entities from FIFO head
    for (let k = 0; k < CHURN_PER_TICK; k++) {
      const slot = jsFifoDequeue()
      jsStorage[slot] = null
      jsFreeList[jsFreeTop++] = slot
    }

    // Step 3: Iterate all live entities (scan FIFO window head..tail, wrapping)
    let idx = jsFifoHead
    const tail = jsFifoTail
    const cap = CAPACITY
    while (idx !== tail) {
      const slot = jsFifoQueue[idx]!
      const e = jsStorage[slot]!
      e.pos.x += e.vel.x * DT
      idx = (idx + 1) % cap
    }
  },

  teardown() {
    // no-op
  },
}

// ---------------------------------------------------------------------------
// RigidJS vec variant
//
// Unlike slab, vec has no persistent slot identity — indices compact on
// swapRemove. We maintain a fixed-size pool at INITIAL_FILL by always:
//   - push()ing CHURN_PER_TICK new entities at the end (indices [len, len+K))
//   - swapRemove()ing index 0 CHURN_PER_TICK times (oldest conceptual entry)
// This keeps len constant at INITIAL_FILL between ticks.
// We pre-allocate to CAPACITY via reserve() to avoid mid-benchmark growth.
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })

let rigidV = vec(Particle, CAPACITY)
let rigidNextId = 0

export const b8VecRigidJs: SustainedScenario = {
  name: 'B8-vec RigidJS vec (100k, 1k churn/tick, 10s)',
  durationMs: DURATION_MS,
  warmupTicks: 50,
  collectHeapTimeSeries: true,

  setup() {
    rigidV = vec(Particle, 1)
    rigidV.reserve(CAPACITY)
    rigidNextId = 0

    // Fill to INITIAL_FILL
    for (let i = 0; i < INITIAL_FILL; i++) {
      const h = rigidV.push()
      h.pos.x = i * 0.1
      h.pos.y = 0
      h.pos.z = 0
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
      h.life = 1
      h.id = rigidNextId++
    }
  },

  tick() {
    // Step 1: Push CHURN_PER_TICK new entities at the back
    for (let k = 0; k < CHURN_PER_TICK; k++) {
      const h = rigidV.push()
      h.pos.x = rigidNextId * 0.1
      h.pos.y = 0
      h.pos.z = 0
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
      h.life = 1
      h.id = rigidNextId++
    }

    // Step 2: swapRemove index 0 CHURN_PER_TICK times (remove "oldest" front entries)
    // Each swapRemove(0) swaps element 0 with the last element and decrements len.
    for (let k = 0; k < CHURN_PER_TICK; k++) {
      rigidV.swapRemove(0)
    }

    // Step 3: Iterate all live entities and mutate pos.x
    // forEach uses a counted loop with shared handle rebase — no allocation per step.
    rigidV.forEach((h) => {
      h.pos.x += h.vel.x * DT
    })
  },

  teardown() {
    rigidV.drop()
  },
}

export const b8VecScenarios: SustainedScenario[] = [b8VecJsBaseline, b8VecRigidJs]
