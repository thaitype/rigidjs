import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { slab } from '../../src/slab/slab.js'

// ---------------------------------------------------------------------------
// Slot-stamped handle tests (milestone-2 task-1 / task-5 amendment)
// Updated for milestone-3 SoA handles: _Handle is no longer set on StructDef.
// Instead, tests use slab(def, capacity) to exercise the generated handle class.
//
// Verifies:
//   - _slot is an internal raw own-property set by the SoA handle constructor
//   - slot is a public read-only getter on the prototype (task-5)
//   - _rebase(slot) updates _slot correctly
//   - Sub-handles share the parent slot (required for SoA TypedArray indexing)
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, life: 'f32', id: 'u32' })

describe('slot-stamped handle — constructor sets _slot', () => {
  it('slab.insert() returns a handle with _slot === 0 (first free slot)', () => {
    const s = slab(Vec3, 10)
    const h = s.insert()
    expect((h as any)._slot).toBe(0)
  })

  it('slab.insert() second call rebases handle to _slot === 1', () => {
    const s = slab(Vec3, 10)
    s.insert() // slot 0
    const h = s.insert()
    expect((h as any)._slot).toBe(1)
  })
})

describe('slot-stamped handle — _rebase updates _slot', () => {
  it('_rebase(9) sets _slot === 9', () => {
    const s = slab(Vec3, 10)
    s.insert()
    const h = s.insert()
    // Directly rebase to slot 9 (no bounds enforcement at _rebase level)
    ;(h as any)._rebase(9)
    expect((h as any)._slot).toBe(9)
  })

  it('get(i) rebases handle and field reads resolve at new slot', () => {
    const s = slab(Vec3, 10)
    const h0 = s.insert() as { x: number }
    h0.x = 1.11

    const h1 = s.insert() as { x: number }
    h1.x = 2.22

    // Rebase to slot 0 via get()
    const g = s.get(0) as { x: number }
    expect(g.x).toBe(1.11)
    expect((g as any)._slot).toBe(0)

    // Rebase to slot 1 via get()
    s.get(1)
    expect(g.x).toBe(2.22)
    expect((g as any)._slot).toBe(1)
  })
})

describe('slot-stamped handle — sub-handles share the parent slot (SoA)', () => {
  it('nested sub-handle _slot matches parent slot after insertion', () => {
    // In SoA layout, sub-handles share the parent's slot so they can index
    // their TypedArray views correctly: this._c_pos_x[this._slot].
    const s = slab(Particle, 10)
    const h = s.insert() as any

    expect(h._slot).toBe(0)
    // Sub-handle (pos) shares the parent slot in SoA
    expect(h.pos._slot).toBe(0)
  })

  it('after _rebase, sub-handle _slot matches the new parent slot', () => {
    const s = slab(Particle, 10)
    s.insert() // slot 0
    const h = s.insert() as any

    expect(h._slot).toBe(1)
    // Sub-handle slot also propagates in SoA
    expect(h.pos._slot).toBe(1)

    // Rebase to slot 0
    h._rebase(0)
    expect(h._slot).toBe(0)
    expect(h.pos._slot).toBe(0)
  })
})

describe('slot-stamped handle — _slot is NOT a getter', () => {
  it('_slot is a plain data property on the instance (not a prototype getter)', () => {
    const s = slab(Vec3, 4)
    const h = s.insert()

    // _slot must be a plain data property (own property), not a getter
    const proto = Object.getPrototypeOf(h) as object
    const protoDescriptor = Object.getOwnPropertyDescriptor(proto, '_slot')
    // No getter on the prototype
    expect(protoDescriptor?.get).toBeUndefined()

    // The value is accessible as an own property
    const ownDescriptor = Object.getOwnPropertyDescriptor(h, '_slot')
    expect(ownDescriptor?.value).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// slot getter (task-5 amendment) — public read-only getter on the prototype
// ---------------------------------------------------------------------------

describe('slot-stamped handle — slot public getter (task-5)', () => {
  it('handle.slot returns the same value as the internal _slot', () => {
    const s = slab(Vec3, 10)
    const h = s.insert()

    expect((h as any).slot).toBe(0)
    expect((h as any).slot).toBe((h as any)._slot)
  })

  it('slot is a getter on the prototype (not an own property)', () => {
    const s = slab(Vec3, 4)
    const h = s.insert()

    const proto = Object.getPrototypeOf(h) as object
    const protoDesc = Object.getOwnPropertyDescriptor(proto, 'slot')

    // Must exist as a getter on the prototype
    expect(typeof protoDesc?.get).toBe('function')

    // No setter — read-only
    expect(protoDesc?.set).toBeUndefined()

    // NOT an own property on the instance
    const ownDesc = Object.getOwnPropertyDescriptor(h, 'slot')
    expect(ownDesc).toBeUndefined()
  })

  it('slot getter updates when handle is rebased via get()', () => {
    const s = slab(Vec3, 3)
    s.insert() // slot 0
    s.insert() // slot 1
    s.insert() // slot 2

    const h = s.get(0)
    expect((h as any).slot).toBe(0)

    s.get(2)
    expect((h as any).slot).toBe(2)
  })

  it('sub-handle slot getter returns the parent slot in SoA (needed for TypedArray indexing)', () => {
    const s = slab(Particle, 10)
    s.insert() // slot 0
    const h = s.insert() as any // slot 1

    // Top-level slot is 1
    expect(h.slot).toBe(1)

    // In SoA layout, sub-handles share the parent's slot
    expect(h.pos.slot).toBe(1)
  })
})
