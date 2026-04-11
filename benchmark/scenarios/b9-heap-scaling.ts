import { struct, slab } from '../../src/index.js'
import type { SustainedScenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B9 — Heap-pressure scaling curve
// Key metrics: p99TickMs, maxTickMs per (variant, capacity) pair
//
// Same workload shape as B8 (insert K, remove K FIFO, iterate-and-mutate)
// but K = Math.floor(capacity * CHURN_RATIO) so per-tick work scales
// proportionally with capacity. Runs at three capacities to test whether
// GC pressure grows with heap size for JS baseline (it should — more
// live JS objects means longer GC pauses) while RigidJS stays flat
// (single ArrayBuffer, no per-entity GC-tracked objects).
//
// XL run (10M capacity) is gated behind RIGIDJS_BENCH_XL=1 env var due to
// ~600MB memory budget. Enable with: RIGIDJS_BENCH_XL=1 bun run bench
// ---------------------------------------------------------------------------

export const PER_CAPACITY_DURATION_MS = 2_000
export const CAPACITIES: readonly number[] = [10_000, 100_000, 1_000_000]
export const XL_CAPACITY = 10_000_000
const CHURN_RATIO = 0.01 // 1% of capacity churned per tick
const DT = 0.016

// ---------------------------------------------------------------------------
// Shared entity shape (same as B8)
// ---------------------------------------------------------------------------

interface Entity {
  pos: { x: number; y: number; z: number }
  vel: { x: number; y: number; z: number }
  life: number
  id: number
}

// ---------------------------------------------------------------------------
// JS baseline factory
// ---------------------------------------------------------------------------

export function b9JsBaselineFactory(capacity: number): SustainedScenario {
  const churnPerTick = Math.floor(capacity * CHURN_RATIO)
  const initialFill = Math.floor(capacity * 0.5)

  // Per-scenario mutable state — each factory call gets fresh state
  let storage: Array<Entity | null> = []
  let freeTop = 0
  let freeList = new Int32Array(capacity)
  let fifoQueue = new Int32Array(capacity)
  let fifoHead = 0
  let fifoTail = 0
  let nextId = 0

  function fifoEnqueue(slot: number): void {
    fifoQueue[fifoTail] = slot
    fifoTail = (fifoTail + 1) % capacity
  }

  function fifoDequeue(): number {
    const slot = fifoQueue[fifoHead]!
    fifoHead = (fifoHead + 1) % capacity
    return slot
  }

  return {
    name: `b9-js-cap${capacity}`,
    durationMs: PER_CAPACITY_DURATION_MS,
    warmupTicks: 25,

    setup() {
      storage = new Array<Entity | null>(capacity).fill(null)
      freeTop = 0
      freeList = new Int32Array(capacity)
      fifoQueue = new Int32Array(capacity)
      fifoHead = 0
      fifoTail = 0
      nextId = 0

      // Build free-list for slots beyond initial fill (high slots first, LIFO)
      for (let i = capacity - 1; i >= initialFill; i--) {
        freeList[freeTop++] = i
      }

      // Fill to initialFill and seed FIFO queue
      for (let i = 0; i < initialFill; i++) {
        storage[i] = {
          pos: { x: i * 0.1, y: 0, z: 0 },
          vel: { x: 1, y: 0, z: 0 },
          life: 1,
          id: nextId++,
        }
        fifoEnqueue(i)
      }
    },

    tick() {
      // Step 1: Insert churnPerTick new entities
      for (let k = 0; k < churnPerTick; k++) {
        const slot = freeList[--freeTop]!
        storage[slot] = {
          pos: { x: slot * 0.1, y: 0, z: 0 },
          vel: { x: 1, y: 0, z: 0 },
          life: 1,
          id: nextId++,
        }
        fifoEnqueue(slot)
      }

      // Step 2: Remove churnPerTick oldest entities from FIFO head
      for (let k = 0; k < churnPerTick; k++) {
        const slot = fifoDequeue()
        storage[slot] = null
        freeList[freeTop++] = slot
      }

      // Step 3: Iterate all live entities via FIFO window and mutate pos.x
      let idx = fifoHead
      const tail = fifoTail
      const cap = capacity
      while (idx !== tail) {
        const slot = fifoQueue[idx]!
        const e = storage[slot]!
        e.pos.x += e.vel.x * DT
        idx = (idx + 1) % cap
      }
    },

    teardown() {
      // no-op
    },
  }
}

// ---------------------------------------------------------------------------
// RigidJS factory
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })

export function b9RigidJsFactory(capacity: number): SustainedScenario {
  const churnPerTick = Math.floor(capacity * CHURN_RATIO)
  const initialFill = Math.floor(capacity * 0.5)

  // Per-scenario mutable state — each factory call gets fresh state
  let s = slab(Particle, capacity)
  let fifoQueue = new Int32Array(capacity)
  let fifoHead = 0
  let fifoTail = 0
  let nextId = 0

  function fifoEnqueue(slot: number): void {
    fifoQueue[fifoTail] = slot
    fifoTail = (fifoTail + 1) % capacity
  }

  function fifoDequeue(): number {
    const slot = fifoQueue[fifoHead]!
    fifoHead = (fifoHead + 1) % capacity
    return slot
  }

  return {
    name: `b9-rigid-cap${capacity}`,
    durationMs: PER_CAPACITY_DURATION_MS,
    warmupTicks: 25,

    setup() {
      s = slab(Particle, capacity)
      fifoQueue = new Int32Array(capacity)
      fifoHead = 0
      fifoTail = 0
      nextId = 0

      // Fill to initialFill and seed FIFO queue with slot keys
      for (let i = 0; i < initialFill; i++) {
        const h = s.insert()
        h.pos.x = i * 0.1
        h.pos.y = 0
        h.pos.z = 0
        h.vel.x = 1
        h.vel.y = 0
        h.vel.z = 0
        h.life = 1
        h.id = nextId++
        fifoEnqueue(h.slot)
      }
    },

    tick() {
      // Step 1: Insert churnPerTick new entities, capture slot keys into FIFO tail
      for (let k = 0; k < churnPerTick; k++) {
        const h = s.insert()
        h.pos.x = nextId * 0.1
        h.pos.y = 0
        h.pos.z = 0
        h.vel.x = 1
        h.vel.y = 0
        h.vel.z = 0
        h.life = 1
        h.id = nextId++
        fifoEnqueue(h.slot)
      }

      // Step 2: Remove churnPerTick oldest entities from FIFO head
      for (let k = 0; k < churnPerTick; k++) {
        const slot = fifoDequeue()
        s.remove(slot)
      }

      // Step 3: Iterate every live entity via FIFO window and mutate pos.x
      // s.get(i) returns the same handle instance rebased to slot i — do not hoist
      // above the loop; each call must be inside the loop body.
      let idx = fifoHead
      const tail = fifoTail
      const cap = capacity
      while (idx !== tail) {
        const slot = fifoQueue[idx]!
        const h = s.get(slot)
        h.pos.x += h.vel.x * DT
        idx = (idx + 1) % cap
      }
    },

    teardown() {
      s.drop()
    },
  }
}
