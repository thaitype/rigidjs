import { struct, slab } from '../../src/index.js'
import type { SustainedScenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B8 — Sustained churn (10s, 100k capacity, 1k churn/tick)
// Key metrics: p99TickMs, p999TickMs, maxTickMs, stdDevTickMs
//
// Tests whether RigidJS's ~300x lower GC-tracked object count translates into
// lower p99 tick latency under sustained workloads. The thesis is "your app
// stops pausing" — two orders of magnitude fewer GC-tracked objects should
// mean fewer GC interruptions during the timing window.
// ---------------------------------------------------------------------------

const DURATION_MS = 10_000
const CAPACITY = 100_000
const INITIAL_FILL = 50_000
const CHURN_PER_TICK = 1_000
const DT = 0.016

// ---------------------------------------------------------------------------
// JS baseline choice: array + numeric free-list (NOT Map<number, Entity>)
//
// Rationale (mirrors B2/B7 design notes):
// - Pre-sized Array<Entity | null> with a numeric free-list mirrors slab's
//   internal structure, isolating object-layout cost (hidden class + GC
//   tracking) from algorithmic differences.
// - Map<number, Entity> would compare data structures rather than GC pressure.
// - Array.push/splice has O(n) semantics that unfairly penalize the baseline.
// - Each Entity uses nested { pos: {x,y,z}, vel: {x,y,z} } shape, matching
//   B7's nested baseline (the idiomatic "particle system in JS" shape).
//   Comparing against the flat variant is out of scope for B8.
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

export const b8JsBaseline: SustainedScenario = {
  name: 'B8 JS baseline (100k, 1k churn/tick, 10s)',
  durationMs: DURATION_MS,
  warmupTicks: 50,

  setup() {
    // Reset all module-level state for a clean measurement
    jsStorage = new Array<Entity | null>(CAPACITY).fill(null)

    // Build free-list in reverse order (LIFO), but only for slots not in initial fill
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
    // The FIFO window [jsFifoHead, jsFifoTail) contains all currently-live slots.
    // We walk the ring buffer directly to iterate every live entity exactly once.
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
// RigidJS variant
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })

// Module-level slab and FIFO state (reset by setup)
let rigidS = slab(Particle, CAPACITY)
let rigidFifoQueue = new Int32Array(CAPACITY)
let rigidFifoHead = 0
let rigidFifoTail = 0
let rigidNextId = 0

function rigidFifoEnqueue(slot: number): void {
  rigidFifoQueue[rigidFifoTail] = slot
  rigidFifoTail = (rigidFifoTail + 1) % CAPACITY
}

function rigidFifoDequeue(): number {
  const slot = rigidFifoQueue[rigidFifoHead]!
  rigidFifoHead = (rigidFifoHead + 1) % CAPACITY
  return slot
}

export const b8RigidJs: SustainedScenario = {
  name: 'B8 RigidJS slab (100k, 1k churn/tick, 10s)',
  durationMs: DURATION_MS,
  warmupTicks: 50,

  setup() {
    rigidS = slab(Particle, CAPACITY)
    rigidFifoQueue = new Int32Array(CAPACITY)
    rigidFifoHead = 0
    rigidFifoTail = 0
    rigidNextId = 0

    // Fill to INITIAL_FILL and seed FIFO queue with slot keys
    for (let i = 0; i < INITIAL_FILL; i++) {
      const h = rigidS.insert()
      h.pos.x = i * 0.1
      h.pos.y = 0
      h.pos.z = 0
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
      h.life = 1
      h.id = rigidNextId++
      rigidFifoEnqueue(h.slot)
    }
  },

  tick() {
    // Step 1: Insert CHURN_PER_TICK new entities, capture slot keys into FIFO tail
    for (let k = 0; k < CHURN_PER_TICK; k++) {
      const h = rigidS.insert()
      h.pos.x = rigidNextId * 0.1
      h.pos.y = 0
      h.pos.z = 0
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
      h.life = 1
      h.id = rigidNextId++
      rigidFifoEnqueue(h.slot)
    }

    // Step 2: Remove CHURN_PER_TICK oldest entities from FIFO head
    for (let k = 0; k < CHURN_PER_TICK; k++) {
      const slot = rigidFifoDequeue()
      rigidS.remove(slot)
    }

    // Step 3: Iterate every live entity via FIFO window and mutate pos.x
    // Walk the ring buffer [rigidFifoHead, rigidFifoTail) to visit every live slot.
    // s.get(i) returns the same handle instance rebased to slot i — do not hoist
    // above the loop; each call must be inside the loop body.
    let idx = rigidFifoHead
    const tail = rigidFifoTail
    const cap = CAPACITY
    while (idx !== tail) {
      const slot = rigidFifoQueue[idx]!
      const h = rigidS.get(slot)
      h.pos.x += h.vel.x * DT
      idx = (idx + 1) % cap
    }
  },

  teardown() {
    rigidS.drop()
  },
}

export const b8Scenarios: SustainedScenario[] = [b8JsBaseline, b8RigidJs]
