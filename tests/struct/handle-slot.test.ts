import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'

// ---------------------------------------------------------------------------
// Slot-stamped handle tests (milestone-2 task-1)
// Verifies that generated handles carry _slot as an internal raw instance property.
// Tests access _slot via (h as any)._slot — it is intentionally not a public getter.
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, life: 'f32', id: 'u32' })

describe('slot-stamped handle — constructor sets _slot', () => {
  it('new _Handle(view, 0, 7) stores _slot === 7', () => {
    if (!Vec3._Handle) throw new Error('Vec3._Handle missing')

    const buffer = new ArrayBuffer(Vec3.sizeof)
    const view = new DataView(buffer)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = new (Vec3._Handle as any)(view, 0, 7)
    expect((h as any)._slot).toBe(7)
  })

  it('new _Handle(view, 0, 0) stores _slot === 0', () => {
    if (!Vec3._Handle) throw new Error('Vec3._Handle missing')

    const buffer = new ArrayBuffer(Vec3.sizeof)
    const view = new DataView(buffer)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = new (Vec3._Handle as any)(view, 0, 0)
    expect((h as any)._slot).toBe(0)
  })
})

describe('slot-stamped handle — _rebase updates _slot', () => {
  it('_rebase(view, 16, 9) sets _slot === 9 and field reads resolve at new offset', () => {
    if (!Vec3._Handle) throw new Error('Vec3._Handle missing')

    // Two slots: slot 0 at offset 0, slot 1 at offset Vec3.sizeof
    const buffer = new ArrayBuffer(Vec3.sizeof * 2)
    const view = new DataView(buffer)

    // Write sentinel values to slot 1 (offset = Vec3.sizeof = 24)
    view.setFloat64(Vec3.sizeof + 0, 1.11, true)   // x
    view.setFloat64(Vec3.sizeof + 8, 2.22, true)   // y
    view.setFloat64(Vec3.sizeof + 16, 3.33, true)  // z

    // Construct handle at slot 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = new (Vec3._Handle as any)(view, 0, 0) as {
      x: number; y: number; z: number
      _rebase(view: DataView, offset: number, slot: number): unknown
    }
    expect((h as any)._slot).toBe(0)

    // Rebase to offset Vec3.sizeof (= 24), slot 9
    h._rebase(view, Vec3.sizeof, 9)

    expect((h as any)._slot).toBe(9)
    // Field reads must now resolve against the new offset
    expect(h.x).toBe(1.11)
    expect(h.y).toBe(2.22)
    expect(h.z).toBe(3.33)
  })
})

describe('slot-stamped handle — sub-handles receive slot=0', () => {
  it('nested sub-handle _slot is 0 after construction', () => {
    if (!Particle._Handle) throw new Error('Particle._Handle missing')

    const buffer = new ArrayBuffer(Particle.sizeof)
    const view = new DataView(buffer)

    // Construct top-level handle with slot=5
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = new (Particle._Handle as any)(view, 0, 5) as {
      pos: object
    }

    // Top-level handle carries the slot
    expect((h as any)._slot).toBe(5)

    // Sub-handle (pos) must always have slot=0
    expect((h.pos as any)._slot).toBe(0)
  })

  it('after _rebase, sub-handle _slot remains 0', () => {
    if (!Particle._Handle) throw new Error('Particle._Handle missing')

    const buffer = new ArrayBuffer(Particle.sizeof * 2)
    const view = new DataView(buffer)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = new (Particle._Handle as any)(view, 0, 3) as {
      pos: object
      _rebase(view: DataView, offset: number, slot: number): unknown
    }

    h._rebase(view, Particle.sizeof, 7)

    expect((h as any)._slot).toBe(7)
    expect((h.pos as any)._slot).toBe(0)
  })
})

describe('slot-stamped handle — _slot is NOT a getter', () => {
  it('Object.getOwnPropertyDescriptor returns no get function for _slot', () => {
    if (!Vec3._Handle) throw new Error('Vec3._Handle missing')

    const buffer = new ArrayBuffer(Vec3.sizeof)
    const view = new DataView(buffer)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = new (Vec3._Handle as any)(view, 0, 42)

    // _slot must be a plain data property (own property), not a getter
    const proto = Object.getPrototypeOf(h) as object
    const protoDescriptor = Object.getOwnPropertyDescriptor(proto, '_slot')
    // No getter on the prototype
    expect(protoDescriptor?.get).toBeUndefined()

    // The value is accessible as an own property
    const ownDescriptor = Object.getOwnPropertyDescriptor(h, '_slot')
    expect(ownDescriptor?.value).toBe(42)
  })
})
