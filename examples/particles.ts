/**
 * examples/particles.ts — end-to-end demonstration of struct() + slab().
 *
 * Simulates N particles (pos/vel integration + lifetime decay) using a
 * fixed-capacity slab. No Math.random() — all initial values are derived
 * from the particle index so output is deterministic and reproducible.
 *
 * # Handle-reuse invariant
 * insert() and get(i) both return the SAME shared handle object. This means:
 *
 *   const a = particles.insert()   // handle is now at slot 0
 *   const b = particles.insert()   // handle is now at slot 1  ← a and b are identical!
 *   particles.remove(a)            // removes slot 1, not slot 0!  ← WRONG
 *
 * Correct idiom: always rebase the handle to a specific slot via get(i)
 * immediately before calling has() or remove(), so the handle points at the
 * intended slot and not wherever the last insert/get left it:
 *
 *   for (let i = 0; i < particles.capacity; i++) {
 *     const h = particles.get(i)   // rebases the shared handle to slot i
 *     if (!particles.has(h)) continue
 *     if ((h as any).life < 0) particles.remove(h)  // removes slot i — correct
 *   }
 *
 * Alternatively, store the slot index (not the handle reference) immediately
 * after insert() if you need to target a specific particle for removal later.
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
// Helper type: field accessor shape for runtime use.
// Handle<F> resolves to `object` at the TypeScript level because the handle
// class is code-generated at runtime. Cast to ParticleHandle at use sites.
// ---------------------------------------------------------------------------

interface Vec3Handle { x: number; y: number; z: number }
interface ParticleHandle {
  pos: Vec3Handle
  vel: Vec3Handle
  life: number
  id: number
}

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
  // Cast to ParticleHandle to access typed fields — the codegen provides
  // these accessors at runtime; the TypeScript type resolves to `object`.
  const h = particles.insert() as unknown as ParticleHandle

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
// Correct iteration pattern: call get(i) once per slot to rebase the shared
// handle, then use the same handle reference for has() and field access.
// ---------------------------------------------------------------------------

const DT = 1.0

for (let i = 0; i < particles.capacity; i++) {
  // get(i) rebases the shared handle to slot i and returns it.
  const h = particles.get(i)
  if (!particles.has(h)) continue

  const p = h as unknown as ParticleHandle
  p.pos.x = p.pos.x + p.vel.x * DT
  p.pos.y = p.pos.y + p.vel.y * DT
  p.pos.z = p.pos.z + p.vel.z * DT
  p.life = p.life - DT
}

// ---------------------------------------------------------------------------
// Remove all particles whose life dropped below zero.
// Call get(i) first — this rebases the shared handle to slot i so that
// remove(h) targets exactly slot i (handle-reuse invariant).
// ---------------------------------------------------------------------------

for (let i = 0; i < particles.capacity; i++) {
  const h = particles.get(i)
  if (!particles.has(h)) continue
  if ((h as unknown as ParticleHandle).life < 0) {
    particles.remove(h)
  }
}

// ---------------------------------------------------------------------------
// Compute a deterministic aggregate over surviving particles
// ---------------------------------------------------------------------------

let sumPosX = 0
let aliveCount = 0

for (let i = 0; i < particles.capacity; i++) {
  const h = particles.get(i)
  if (!particles.has(h)) continue
  sumPosX += (h as unknown as ParticleHandle).pos.x
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
