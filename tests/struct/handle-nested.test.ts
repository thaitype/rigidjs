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

describe('Particle field offsets via raw DataView', () => {
  it('pos starts at byte 0 (pos.x at offset 0)', () => {
    const { handle, view } = createSingleSlot(Particle)
    const p = handle as { pos: { x: number; y: number; z: number }; vel: { x: number }; life: number; id: number }
    p.pos.x = 1.5
    expect(view.getFloat64(0, true)).toBe(1.5)
  })

  it('vel starts at byte 24 (vel.x at offset 24)', () => {
    const { handle, view } = createSingleSlot(Particle)
    const p = handle as { pos: { x: number }; vel: { x: number }; life: number; id: number }
    p.vel.x = -1
    expect(view.getFloat64(24, true)).toBe(-1)
  })

  it('life is at byte 48', () => {
    const { handle, view } = createSingleSlot(Particle)
    const p = handle as { pos: { x: number }; vel: { x: number }; life: number; id: number }
    p.life = 0.25
    expect(view.getFloat32(48, true)).toBe(0.25)
  })

  it('id is at byte 52', () => {
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
// Rebasing test: two slots in one ArrayBuffer
// ---------------------------------------------------------------------------

describe('_rebase — offset rebasing across two slots', () => {
  it('rebasing handle to slot 1 writes/reads independently from slot 0', () => {
    const sizeof = Particle.sizeof // 56
    const buffer = new ArrayBuffer(sizeof * 2)
    const view = new DataView(buffer)

    if (!Particle._Handle) throw new Error('Particle._Handle missing')

    // Construct handle at slot 0 (offset 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = new (Particle._Handle as any)(view, 0) as {
      pos: { x: number; y: number; z: number }
      vel: { x: number }
      life: number
      id: number
      _rebase(view: DataView, offset: number): unknown
    }

    // Write data to slot 0
    handle.pos.x = 10
    handle.pos.y = 20
    handle.vel.x = -5
    handle.life = 0.5
    handle.id = 1

    // Rebase handle to slot 1 (offset = sizeof)
    handle._rebase(view, sizeof)

    // Write different data to slot 1
    handle.pos.x = 99
    handle.pos.y = 88
    handle.vel.x = -99
    handle.life = 0.9
    handle.id = 2

    // Verify slot 1 data via handle
    expect(handle.pos.x).toBe(99)
    expect(handle.pos.y).toBe(88)
    expect(handle.vel.x).toBe(-99)
    expect(handle.id).toBe(2)

    // Verify slot 0 bytes are untouched
    expect(view.getFloat64(0, true)).toBe(10)     // slot0 pos.x
    expect(view.getFloat64(8, true)).toBe(20)     // slot0 pos.y
    expect(view.getFloat64(24, true)).toBe(-5)    // slot0 vel.x
    expect(view.getUint32(52, true)).toBe(1)      // slot0 id

    // Verify slot 1 bytes are correct
    expect(view.getFloat64(sizeof + 0, true)).toBe(99)    // slot1 pos.x
    expect(view.getFloat64(sizeof + 8, true)).toBe(88)    // slot1 pos.y
    expect(view.getFloat64(sizeof + 24, true)).toBe(-99)  // slot1 vel.x
    expect(view.getUint32(sizeof + 52, true)).toBe(2)     // slot1 id
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

  it('_rebase propagates through 2 levels', () => {
    const sizeof = Deep.sizeof // 24
    const buffer = new ArrayBuffer(sizeof * 2)
    const view = new DataView(buffer)

    if (!Deep._Handle) throw new Error('Deep._Handle missing')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = new (Deep._Handle as any)(view, 0) as {
      outer: { inner: { x: number } }
      _rebase(view: DataView, offset: number): unknown
    }

    // Write to slot 0
    handle.outer.inner.x = 1.1

    // Rebase to slot 1
    handle._rebase(view, sizeof)

    // Write to slot 1
    handle.outer.inner.x = 2.2

    // Verify both slots are distinct
    expect(view.getFloat64(0, true)).toBe(1.1)           // slot 0
    expect(view.getFloat64(sizeof, true)).toBe(2.2)      // slot 1
    expect(handle.outer.inner.x).toBe(2.2)
  })

  it('sub-handle identity is preserved after rebase (outer === outer)', () => {
    const { handle } = createSingleSlot(Deep)
    const h = handle as { outer: object }

    const before = h.outer
    // Access twice — same reference
    expect(h.outer).toBe(before)
  })
})
