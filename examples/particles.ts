/**
 * examples/particles.ts — end-to-end demonstration of struct() + slab().
 *
 * Simulates N particles (pos/vel integration + lifetime decay) using a
 * fixed-capacity slab. No Math.random() — all initial values are derived
 * from the particle index so output is deterministic and reproducible.
 *
 * # Handle reuse + slot-capture invariant (task-5 amendment)
 * insert() and get(i) both return the SAME shared handle object. This means
 * holding onto a handle reference across multiple insert()/get() calls is
 * a footgun — the handle moves to the most recently rebased slot.
 *
 * The correct pattern for stable slot references is to capture the NUMERIC
 * index immediately after insert():
 *
 *   const slotA = particles.insert().slot   // slot 0 — a primitive number
 *   const slotB = particles.insert().slot   // slot 1 — handle now at slot 1
 *   // slotA is still 0; it is immune to handle rebasing
 *   particles.remove(slotA)                 // removes slot 0 — correct
 *
 * remove(), has(), and get() all take the numeric slot directly:
 *
 *   for (let i = 0; i < particles.capacity; i++) {
 *     if (!particles.has(i)) continue
 *     const h = particles.get(i)
 *     h.pos.x += h.vel.x
 *   }
 *
 * This is allocation-free and stale-reference-proof.
 *
 * # Field access is directly typed
 * struct() uses a `const` type parameter so literal tokens like 'f64' are
 * preserved. Handle<F> maps each field to its JS type (number for numeric
 * tokens, Handle<G> for nested structs). No shadow interfaces or casts needed.
 */

import { struct, slab, type Slab } from '../src/index.js'

// ---------------------------------------------------------------------------
// Struct definitions (mirroring the design spec §4.1)
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

const Particle = struct({
  pos: Vec3,    // 24 bytes inline
  vel: Vec3,    // 24 bytes inline
  life: 'f32',  // 4 bytes
  id: 'u32',    // 4 bytes
})
// sizeof(Particle) === 56 bytes

// ---------------------------------------------------------------------------
// Slab creation
// ---------------------------------------------------------------------------

const CAPACITY = 1024
const N = 500

const particles: Slab<typeof Particle.fields> = slab(Particle, CAPACITY)

// ---------------------------------------------------------------------------
// Insert N particles with deterministic initial values (LCG — no Math.random)
// ---------------------------------------------------------------------------

// Tiny LCG: returns next seed and a value in [0, 1).
function lcg(seed: number): { next: number; value: number } {
  const next = (seed * 1664525 + 1013904223) >>> 0
  return { next, value: next / 0x100000000 }
}

let seed = 42
for (let i = 0; i < N; i++) {
  // insert() returns the shared handle rebased to the new slot.
  // Field access is fully typed — no cast needed.
  const h = particles.insert()

  let r = lcg(seed)
  h.pos.x = r.value * 200 - 100
  r = lcg(r.next)
  h.pos.y = r.value * 200 - 100
  r = lcg(r.next)
  h.pos.z = r.value * 200 - 100

  r = lcg(r.next)
  h.vel.x = r.value * 2 - 1
  r = lcg(r.next)
  h.vel.y = r.value * 2 - 1
  r = lcg(r.next)
  h.vel.z = r.value * 2 - 1

  // life in [0.5, 1.5] — roughly half the particles will die after one tick
  // (life -= 1.0 per tick; those with life < 0.5 start below zero after tick)
  r = lcg(r.next)
  h.life = r.value + 0.5

  h.id = i

  seed = r.next
}

// ---------------------------------------------------------------------------
// One fixed simulation tick: integrate pos by vel and decrement life by 1.0
//
// New idiom: has(i) takes the numeric slot directly.
// get(i) rebases the shared handle to slot i and returns it.
// ---------------------------------------------------------------------------

const DT = 1.0

for (let i = 0; i < particles.capacity; i++) {
  if (!particles.has(i)) continue
  const h = particles.get(i)
  h.pos.x = h.pos.x + h.vel.x * DT
  h.pos.y = h.pos.y + h.vel.y * DT
  h.pos.z = h.pos.z + h.vel.z * DT
  h.life = h.life - DT
}

// ---------------------------------------------------------------------------
// Remove all particles whose life dropped below zero.
//
// New idiom: remove(i) takes the numeric slot directly — no handle needed.
// ---------------------------------------------------------------------------

for (let i = 0; i < particles.capacity; i++) {
  if (!particles.has(i)) continue
  const h = particles.get(i)
  if (h.life < 0) particles.remove(i)
}

// ---------------------------------------------------------------------------
// Compute a deterministic aggregate over surviving particles
// ---------------------------------------------------------------------------

let sumPosX = 0
let aliveCount = 0

for (let i = 0; i < particles.capacity; i++) {
  if (!particles.has(i)) continue
  sumPosX += particles.get(i).pos.x
  aliveCount++
}

// ---------------------------------------------------------------------------
// Print summary
// ---------------------------------------------------------------------------

console.log('capacity:', particles.capacity)
console.log('len (after removal):', particles.len)
console.log('alive count (manual):', aliveCount)
console.log('sum pos.x (alive):', sumPosX.toFixed(6))

// ---------------------------------------------------------------------------
// Release the slab
// ---------------------------------------------------------------------------

particles.drop()
