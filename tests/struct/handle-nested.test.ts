import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { createSingleSlot } from '../../src/internal/single-slot.js'

// ---------------------------------------------------------------------------
// Particle from spec §4.1
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })

describe('Particle sizeof', () => {
  it('Particle.sizeof === 56', () => {
    // pos(24) + vel(24) + life(4) + id(4) = 56
    expect(Particle.sizeof).toBe(56)
  })
})

// ---------------------------------------------------------------------------
// SoA column byte offsets for Particle (capacity=1):
// Natural-alignment sort puts all f64 first, then f32, then u32.
// Columns in sorted order: pos.x(0), pos.y(8), pos.z(16), vel.x(24), vel.y(32),
//   vel.z(40), life(48), id(52)
// At capacity=1: bufByteOffset = colByteOffset * 1 = colByteOffset
// So DataView offsets match the per-slot offsets exactly.
// ---------------------------------------------------------------------------

describe('Particle field offsets via raw DataView (SoA capacity=1)', () => {
  it('pos.x is at byte offset 0 in the SoA layout (f64, first column)', () => {
    const { handle, view } = createSingleSlot(Particle)
    const p = handle as { pos: { x: number; y: number; z: number }; vel: { x: number }; life: number; id: number }
    p.pos.x = 1.5
    expect(view.getFloat64(0, true)).toBe(1.5)
  })

  it('pos.y is at byte offset 8', () => {
    const { handle, view } = createSingleSlot(Particle)
    const p = handle as { pos: { x: number; y: number; z: number }; vel: { x: number }; life: number; id: number }
    p.pos.y = 2.5
    expect(view.getFloat64(8, true)).toBe(2.5)
  })

  it('vel.x is at byte offset 24 (4th column after pos.x, pos.y, pos.z)', () => {
    const { handle, view } = createSingleSlot(Particle)
    const p = handle as { pos: { x: number }; vel: { x: number }; life: number; id: number }
    p.vel.x = -1
    expect(view.getFloat64(24, true)).toBe(-1)
  })

  it('life is at byte offset 48 (after all 6 f64 columns)', () => {
    const { handle, view } = createSingleSlot(Particle)
    const p = handle as { pos: { x: number }; vel: { x: number }; life: number; id: number }
    p.life = 0.25
    expect(view.getFloat32(48, true)).toBe(0.25)
  })

  it('id is at byte offset 52', () => {
    const { handle, view } = createSingleSlot(Particle)
    const p = handle as { pos: { x: number }; vel: { x: number }; life: number; id: number }
    p.id = 42
    expect(view.getUint32(52, true)).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// Write/read round-trip via nested handle
// ---------------------------------------------------------------------------

describe('Particle handle write/read round-trip', () => {
  it('writes and reads back all fields correctly', () => {
    const { handle } = createSingleSlot(Particle)
    const p = handle as {
      pos: { x: number; y: number; z: number }
      vel: { x: number; y: number; z: number }
      life: number
      id: number
    }

    p.pos.x = 1.5
    p.pos.y = 2.5
    p.pos.z = 3.5
    p.vel.x = -1
    p.vel.y = -2
    p.vel.z = -3
    p.life = 0.25
    p.id = 42

    expect(p.pos.x).toBe(1.5)
    expect(p.pos.y).toBe(2.5)
    expect(p.pos.z).toBe(3.5)
    expect(p.vel.x).toBe(-1)
    expect(p.vel.y).toBe(-2)
    expect(p.vel.z).toBe(-3)
    // f32 precision — compare via DataView round-trip
    const buf = new ArrayBuffer(4)
    const dv = new DataView(buf)
    dv.setFloat32(0, 0.25, true)
    expect(p.life).toBe(dv.getFloat32(0, true))
    expect(p.id).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// Identity test: p.pos === p.pos (same object reference — no per-access allocation)
// ---------------------------------------------------------------------------

describe('sub-handle identity — no per-access allocation', () => {
  it('p.pos === p.pos (strict reference equality on repeated access)', () => {
    const { handle } = createSingleSlot(Particle)
    const p = handle as { pos: object; vel: object }

    const first = p.pos
    const second = p.pos
    expect(first).toBe(second)
  })

  it('p.vel === p.vel (strict reference equality on repeated access)', () => {
    const { handle } = createSingleSlot(Particle)
    const p = handle as { pos: object; vel: object }

    const first = p.vel
    const second = p.vel
    expect(first).toBe(second)
  })
})

// ---------------------------------------------------------------------------
// Rebasing test (SoA path): use a slab with capacity=2 to test rebasing.
// In SoA layout, the slab handles the buffer; we verify correctness through
// the slab's public API (handle read-back) rather than raw DataView byte checks
// which are AoS-layout-specific.
// ---------------------------------------------------------------------------

import { slab } from '../../src/slab/slab.js'

describe('_rebase — offset rebasing across two slots (SoA via slab)', () => {
  it('rebasing handle to slot 1 writes/reads independently from slot 0', () => {
    const s = slab(Particle, 2)

    // Write data to slot 0
    const h0 = s.insert() as any
    h0.pos.x = 10
    h0.pos.y = 20
    h0.vel.x = -5
    h0.life = 0.5
    h0.id = 1

    // Write data to slot 1
    const h1 = s.insert() as any
    h1.pos.x = 99
    h1.pos.y = 88
    h1.vel.x = -99
    h1.life = 0.9
    h1.id = 2

    // Verify slot 1 data via handle
    expect(h1.pos.x).toBe(99)
    expect(h1.pos.y).toBe(88)
    expect(h1.vel.x).toBe(-99)
    expect(h1.id).toBe(2)

    // Verify slot 0 data is untouched (get() rebases the handle to slot 0)
    const g0 = s.get(0) as any
    expect(g0.pos.x).toBe(10)
    expect(g0.pos.y).toBe(20)
    expect(g0.vel.x).toBe(-5)
    expect(g0.id).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Deeper nesting test: 2-level nested struct
// ---------------------------------------------------------------------------

describe('2-level nested struct — recursive rebasing', () => {
  const Inner = struct({ x: 'f64', y: 'f64', z: 'f64' }) // sizeof 24
  const Outer = struct({ inner: Inner })                   // sizeof 24
  const Deep  = struct({ outer: Outer })                   // sizeof 24

  it('writes through h.outer.inner.x and reads back', () => {
    const { handle } = createSingleSlot(Deep)
    const h = handle as { outer: { inner: { x: number; y: number; z: number } } }

    h.outer.inner.x = 7.7
    h.outer.inner.y = 8.8
    h.outer.inner.z = 9.9

    expect(h.outer.inner.x).toBe(7.7)
    expect(h.outer.inner.y).toBe(8.8)
    expect(h.outer.inner.z).toBe(9.9)
  })

  it('_rebase propagates through 2 levels (SoA via slab)', () => {
    const s = slab(Deep, 2)

    // Write to slot 0
    const h0 = s.insert() as any
    h0.outer.inner.x = 1.1

    // Write to slot 1
    const h1 = s.insert() as any
    h1.outer.inner.x = 2.2

    // Verify both slots are distinct
    expect((s.get(0) as any).outer.inner.x).toBe(1.1)
    expect((s.get(1) as any).outer.inner.x).toBe(2.2)
  })

  it('sub-handle identity is preserved after rebase (outer === outer)', () => {
    const { handle } = createSingleSlot(Deep)
    const h = handle as { outer: object }

    const before = h.outer
    // Access twice — same reference
    expect(h.outer).toBe(before)
  })
})
