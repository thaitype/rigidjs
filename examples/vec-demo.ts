/**
 * examples/vec-demo.ts — end-to-end demonstration of struct() + vec().
 *
 * Covers: push, field access, for..of iteration, swapRemove, remove,
 * column access, and drop. All output is deterministic (no Math.random).
 *
 * Run: bun run examples/vec-demo.ts
 */

import { struct, vec, type Vec } from '../src/index.js'

// ---------------------------------------------------------------------------
// Struct definitions
// ---------------------------------------------------------------------------

const Vec2 = struct({ x: 'f64', y: 'f64' })

const Particle = struct({
  pos: Vec2,
  id: 'u32',
  life: 'f32',
})

// ---------------------------------------------------------------------------
// Create a vec with an explicit initial capacity
// ---------------------------------------------------------------------------

const particles: Vec<typeof Particle.fields> = vec(Particle, 8)

console.log('--- Initial state ---')
console.log('len:     ', particles.len)       // 0
console.log('capacity:', particles.capacity)  // 8

// ---------------------------------------------------------------------------
// Push elements with deterministic field values
// ---------------------------------------------------------------------------

console.log('\n--- Push 5 particles ---')
for (let i = 0; i < 5; i++) {
  const h = particles.push()
  h.pos.x = i * 10.0
  h.pos.y = i * -5.0
  h.id = i
  h.life = 1.0 - i * 0.15
}

console.log('len after push:', particles.len)  // 5

// ---------------------------------------------------------------------------
// Field access via get()
// ---------------------------------------------------------------------------

console.log('\n--- Field access via get() ---')
for (let i = 0; i < particles.len; i++) {
  const h = particles.get(i)
  console.log(`  [${i}] id=${h.id} pos=(${h.pos.x}, ${h.pos.y}) life=${h.life.toFixed(2)}`)
}

// ---------------------------------------------------------------------------
// for..of iteration — same handle instance rebased each step
// ---------------------------------------------------------------------------

console.log('\n--- for..of iteration ---')
let sumX = 0
for (const h of particles) {
  sumX += h.pos.x
  console.log(`  slot=${h.slot} id=${h.id} pos.x=${h.pos.x}`)
}
console.log('sumX:', sumX)  // 0+10+20+30+40 = 100

// ---------------------------------------------------------------------------
// Column access — direct TypedArray view
// ---------------------------------------------------------------------------

console.log('\n--- Column access ---')
const ids = particles.column('id')
const posX = particles.column('pos.x')
console.log('ids (first 5):  ', Array.from(ids.subarray(0, particles.len)))
console.log('pos.x (first 5):', Array.from(posX.subarray(0, particles.len)))

// Verify index identity: column[i] === get(i).pos.x
for (let i = 0; i < particles.len; i++) {
  const fromColumn = posX[i]
  const fromHandle = particles.get(i).pos.x
  if (fromColumn !== fromHandle) {
    throw new Error(`Column/handle mismatch at index ${i}: ${fromColumn} !== ${fromHandle}`)
  }
}
console.log('column/handle identity check: OK')

// ---------------------------------------------------------------------------
// swapRemove — O(1), changes order
// ---------------------------------------------------------------------------

console.log('\n--- swapRemove(1) --- (removes index 1, moves last element there)')
const idBefore = particles.get(1).id
const idLast = particles.get(particles.len - 1).id
console.log(`  before: index 1 has id=${idBefore}, last (index ${particles.len - 1}) has id=${idLast}`)
particles.swapRemove(1)
console.log(`  after swapRemove: len=${particles.len}, index 1 now has id=${particles.get(1).id}`)

// ---------------------------------------------------------------------------
// remove — O(n), preserves order
// ---------------------------------------------------------------------------

console.log('\n--- remove(0) --- (preserves order)')
const idAt0 = particles.get(0).id
const idAt1 = particles.get(1).id
console.log(`  before: index 0 has id=${idAt0}, index 1 has id=${idAt1}`)
particles.remove(0)
console.log(`  after remove(0): len=${particles.len}, index 0 now has id=${particles.get(0).id}`)

// ---------------------------------------------------------------------------
// for..of after modifications
// ---------------------------------------------------------------------------

console.log('\n--- for..of after swapRemove+remove ---')
for (const h of particles) {
  console.log(`  slot=${h.slot} id=${h.id}`)
}

// ---------------------------------------------------------------------------
// drop — releases the buffer
// ---------------------------------------------------------------------------

console.log('\n--- drop ---')
particles.drop()
let threw = false
try {
  particles.push()
} catch (e) {
  threw = true
  console.log('push after drop threw as expected:', (e as Error).message)
}
if (!threw) throw new Error('expected push after drop to throw')

console.log('\nvec-demo complete.')
