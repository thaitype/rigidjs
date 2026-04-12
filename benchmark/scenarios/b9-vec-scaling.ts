import { struct, vec } from '../../src/index.js'
import type { SustainedScenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B9-vec — Heap-pressure scaling curve for vec
// Key metrics: p99TickMs, maxTickMs per (variant, capacity) pair
//
// Mirrors B9-slab but uses vec with push/swapRemove instead of slab insert/remove.
// Same workload shape: insert K, remove K (swapRemove from front), iterate-and-
// mutate. K = Math.floor(capacity * CHURN_RATIO) so per-tick work scales
// proportionally with capacity.
//
// Runs at three capacities to demonstrate whether GC pressure grows with heap
// size for the JS baseline (more live objects → longer GC pauses) while
// RigidJS vec stays flat (single ArrayBuffer, no per-entity GC objects).
//
// XL run (10M capacity) is gated behind RIGIDJS_BENCH_XL=1 env var.
// ---------------------------------------------------------------------------

export const PER_CAPACITY_DURATION_MS = 2_000
export const CAPACITIES: readonly number[] = [10_000, 100_000, 1_000_000]
export const XL_CAPACITY = 10_000_000
const CHURN_RATIO = 0.01 // 1% of capacity churned per tick
const DT = 0.016

// ---------------------------------------------------------------------------
// Shared entity shape (same as B9-slab)
// ---------------------------------------------------------------------------

interface Entity {
  pos: { x: number; y: number; z: number }
  vel: { x: number; y: number; z: number }
  life: number
  id: number
}

// ---------------------------------------------------------------------------
// JS baseline factory (identical to B9-slab JS baseline)
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
    name: `b9-vec-js-cap${capacity}`,
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
// RigidJS vec factory
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })

export function b9RigidJsFactory(capacity: number): SustainedScenario {
  const churnPerTick = Math.floor(capacity * CHURN_RATIO)
  const initialFill = Math.floor(capacity * 0.5)

  // Per-scenario mutable state — each factory call gets fresh state
  let v = vec(Particle, 1)
  let nextId = 0

  return {
    name: `b9-vec-rigid-cap${capacity}`,
    durationMs: PER_CAPACITY_DURATION_MS,
    warmupTicks: 25,

    setup() {
      v = vec(Particle, 1)
      v.reserve(capacity)
      nextId = 0

      // Fill to initialFill
      for (let i = 0; i < initialFill; i++) {
        const h = v.push()
        h.pos.x = i * 0.1
        h.pos.y = 0
        h.pos.z = 0
        h.vel.x = 1
        h.vel.y = 0
        h.vel.z = 0
        h.life = 1
        h.id = nextId++
      }
    },

    tick() {
      // Step 1: Push churnPerTick new entities at the back
      for (let k = 0; k < churnPerTick; k++) {
        const h = v.push()
        h.pos.x = nextId * 0.1
        h.pos.y = 0
        h.pos.z = 0
        h.vel.x = 1
        h.vel.y = 0
        h.vel.z = 0
        h.life = 1
        h.id = nextId++
      }

      // Step 2: swapRemove index 0 churnPerTick times (remove front/oldest)
      // Each swapRemove(0) swaps element 0 with the last and decrements len.
      for (let k = 0; k < churnPerTick; k++) {
        v.swapRemove(0)
      }

      // Step 3: Iterate all live entities via forEach and mutate pos.x
      v.forEach((h) => {
        h.pos.x += h.vel.x * DT
      })
    },

    teardown() {
      v.drop()
    },
  }
}
