/**
 * Tests for src/slab/slab.ts — milestone-2 task-3.
 *
 * Covers:
 *   - construction / validation
 *   - insert / get / field round-trip (all 8 numeric types)
 *   - handle reuse semantics
 *   - slot recycling
 *   - capacity exhaustion
 *   - clear()
 *   - drop()
 *   - error paths
 *   - has()
 *   - nested struct (Particle)
 *   - no premature public export from src/index.ts
 */

import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { slab } from '../../src/slab/slab.ts'
import type { Slab, Handle } from '../../src/slab/slab.ts'
import type { NumericType } from '../../src/types.js'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('slab — construction', () => {
  it('capacity and len are correct after construction', () => {
    const s = slab(Vec3, 10)
    expect(s.capacity).toBe(10)
    expect(s.len).toBe(0)
  })

  it('buffer.byteLength equals sizeof * capacity', () => {
    const s = slab(Vec3, 10)
    expect(s.buffer.byteLength).toBe(24 * 10)
  })

  it('slab(Vec3, 0) throws', () => {
    expect(() => slab(Vec3, 0)).toThrow('slab: capacity must be a positive integer')
  })

  it('slab(Vec3, -1) throws', () => {
    expect(() => slab(Vec3, -1)).toThrow('slab: capacity must be a positive integer')
  })

  it('slab(Vec3, 1.5) throws', () => {
    expect(() => slab(Vec3, 1.5)).toThrow('slab: capacity must be a positive integer')
  })

  it('slab(Vec3, NaN) throws', () => {
    expect(() => slab(Vec3, NaN)).toThrow('slab: capacity must be a positive integer')
  })

  it('slab throws if def has no _Handle', () => {
    // Construct a fake StructDef without _Handle
    const fakeDef = { sizeof: 8, fields: { x: 'f64' as NumericType } }
    expect(() => slab(fakeDef as any, 4)).toThrow(
      'slab: StructDef has no _Handle — was it created by struct()?',
    )
  })
})

// ---------------------------------------------------------------------------
// Insert / get / field round-trip — Vec3
// ---------------------------------------------------------------------------

describe('slab — insert / get / field round-trip (Vec3)', () => {
  it('insert one Vec3, write x=1 y=2 z=3, read back via returned handle', () => {
    const s = slab(Vec3, 10)
    const h = s.insert() as { x: number; y: number; z: number }
    h.x = 1
    h.y = 2
    h.z = 3
    expect(s.len).toBe(1)
    expect(h.x).toBe(1)
    expect(h.y).toBe(2)
    expect(h.z).toBe(3)
  })

  it('insert fills slot 0 first — get(0) points at same raw bytes', () => {
    const s = slab(Vec3, 10)
    const h = s.insert() as { x: number; y: number; z: number }
    h.x = 42
    // get(0) rebases to slot 0 — should see the same written value
    const g = s.get(0) as { x: number }
    expect(g.x).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// Insert / get / field round-trip — all 8 numeric types
// ---------------------------------------------------------------------------

describe('slab — all 8 numeric types round-trip', () => {
  const cases: Array<[NumericType, number]> = [
    ['f64', 1.23456789012345],
    ['f32', 3.14],
    ['u32', 0xdeadbeef >>> 0],
    ['u16', 0xabcd],
    ['u8', 0xff],
    ['i32', -2147483648],
    ['i16', -32768],
    ['i8', -128],
  ]

  for (const [type, value] of cases) {
    it(`round-trip for '${type}': write ${value}, read back via slab`, () => {
      const Def = struct({ v: type })
      const s = slab(Def, 4)
      const h = s.insert() as Record<string, number>
      h['v'] = value

      const readBack: number = h['v']!

      if (type === 'f32') {
        // f32 loses precision — compare within float32 tolerance
        const buf = new ArrayBuffer(4)
        const dv = new DataView(buf)
        dv.setFloat32(0, value, true)
        const expected = dv.getFloat32(0, true)
        expect(readBack).toBeCloseTo(expected, 5)
      } else {
        expect(readBack).toBe(value)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Handle reuse semantics
// ---------------------------------------------------------------------------

describe('slab — handle reuse semantics', () => {
  it('two sequential insert() calls return the same handle instance', () => {
    const s = slab(Vec3, 10)
    const a = s.insert()
    const b = s.insert()
    expect(a === b).toBe(true)
  })

  it('rebasing handle does not corrupt prior slot data', () => {
    const s = slab(Vec3, 10)
    const a = s.insert() as { x: number }
    a.x = 1
    // insert() rebases handle to slot 1 — slot 0 data must be untouched
    const b = s.insert() as { x: number }
    b.x = 2
    // get(0) returns same handle rebased to slot 0
    expect((s.get(0) as { x: number }).x).toBe(1)
    expect((s.get(1) as { x: number }).x).toBe(2)
  })

  it('get() returns the same handle instance as insert()', () => {
    const s = slab(Vec3, 10)
    const h = s.insert()
    expect(s.get(0) === h).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Slot recycling
// ---------------------------------------------------------------------------

describe('slab — slot recycling', () => {
  it('freed slot is reused on next insert (LIFO free-list)', () => {
    // NOTE: The handle is a shared instance — insert() and get() both rebase it.
    // To remove a specific slot after the handle has been rebased elsewhere,
    // use get(targetSlot) to rebase the handle back before calling remove().
    //
    // Scenario: insert slot 0, insert slot 1, remove slot 0, insert → gets slot 0 back.
    const s = slab(Vec3, 2)
    s.insert() // fills slot 0 — handle now at slot 0
    s.insert() // fills slot 1 — handle rebased to slot 1

    // Rebase handle to slot 0 and remove it
    s.remove(s.get(0)) // frees slot 0
    expect(s.len).toBe(1)

    // Next insert should recycle slot 0 (LIFO — slot 0 was just freed)
    const c = s.insert()
    const slotC: number = (c as any)._slot
    expect(slotC).toBe(0)
  })

  it('len tracks correctly across insert/remove sequences', () => {
    const s = slab(Vec3, 5)
    s.insert() // slot 0
    s.insert() // slot 1
    expect(s.len).toBe(2)
    // Remove each slot via get() to avoid shared-handle confusion
    s.remove(s.get(0))
    expect(s.len).toBe(1)
    s.remove(s.get(1))
    expect(s.len).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Capacity exhaustion
// ---------------------------------------------------------------------------

describe('slab — capacity exhaustion', () => {
  it('insert() throws "slab at capacity" when slab is full', () => {
    const s = slab(Vec3, 3)
    s.insert()
    s.insert()
    s.insert()
    expect(() => s.insert()).toThrow('slab at capacity')
  })
})

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

describe('slab — clear()', () => {
  it('clear() resets len to 0', () => {
    const s = slab(Vec3, 5)
    s.insert()
    s.insert()
    s.clear()
    expect(s.len).toBe(0)
  })

  it('after clear(), next insert fills slot 0 again', () => {
    const s = slab(Vec3, 5)
    s.insert()
    s.insert()
    s.insert()
    s.clear()
    const h = s.insert()
    expect((h as any)._slot).toBe(0)
  })

  it('clear() does NOT reallocate the buffer', () => {
    const s = slab(Vec3, 5)
    const bufBefore = s.buffer
    s.insert()
    s.insert()
    s.clear()
    const bufAfter = s.buffer
    expect(bufBefore === bufAfter).toBe(true)
  })

  it('after clear() capacity is full, can fill to capacity again', () => {
    const s = slab(Vec3, 3)
    s.insert()
    s.insert()
    s.insert()
    s.clear()
    // Should not throw
    s.insert()
    s.insert()
    s.insert()
    expect(s.len).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// drop()
// ---------------------------------------------------------------------------

describe('slab — drop()', () => {
  it('drop() then insert() throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    s.drop()
    expect(() => s.insert()).toThrow('slab has been dropped')
  })

  it('drop() then remove() throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    // Insert before drop so we have a handle
    const h = s.insert()
    s.drop()
    expect(() => s.remove(h)).toThrow('slab has been dropped')
  })

  it('drop() then get() throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    s.drop()
    expect(() => s.get(0)).toThrow('slab has been dropped')
  })

  it('drop() then has() throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    const h = s.insert()
    s.drop()
    expect(() => s.has(h)).toThrow('slab has been dropped')
  })

  it('drop() then .len throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    s.drop()
    expect(() => s.len).toThrow('slab has been dropped')
  })

  it('drop() then .capacity throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    s.drop()
    expect(() => s.capacity).toThrow('slab has been dropped')
  })

  it('drop() then .buffer throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    s.drop()
    expect(() => s.buffer).toThrow('slab has been dropped')
  })

  it('drop() then clear() throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    s.drop()
    expect(() => s.clear()).toThrow('slab has been dropped')
  })

  it('calling drop() twice throws "slab has been dropped"', () => {
    const s = slab(Vec3, 5)
    s.drop()
    expect(() => s.drop()).toThrow('slab has been dropped')
  })
})

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('slab — error paths', () => {
  it('get(-1) throws "slab: index out of range"', () => {
    const s = slab(Vec3, 5)
    expect(() => s.get(-1)).toThrow('slab: index out of range')
  })

  it('get(capacity) throws "slab: index out of range"', () => {
    const s = slab(Vec3, 5)
    expect(() => s.get(5)).toThrow('slab: index out of range')
  })

  it('get(0.5) throws "slab: index out of range"', () => {
    const s = slab(Vec3, 5)
    expect(() => s.get(0.5)).toThrow('slab: index out of range')
  })

  it('get(NaN) throws "slab: index out of range"', () => {
    const s = slab(Vec3, 5)
    expect(() => s.get(NaN)).toThrow('slab: index out of range')
  })

  it('double remove throws "slab: double remove at slot 0"', () => {
    const s = slab(Vec3, 5)
    const h = s.insert()
    expect((h as any)._slot).toBe(0)
    s.remove(h)
    expect(() => s.remove(h)).toThrow(/slab: double remove at slot 0/)
  })
})

// ---------------------------------------------------------------------------
// has()
// ---------------------------------------------------------------------------

describe('slab — has()', () => {
  it('has(h) === true after insert()', () => {
    const s = slab(Vec3, 5)
    const h = s.insert()
    expect(s.has(h)).toBe(true)
  })

  it('has(h) === false after remove(h)', () => {
    const s = slab(Vec3, 5)
    const h = s.insert()
    s.remove(h)
    expect(s.has(h)).toBe(false)
  })

  it('has(slab.get(i)) checks arbitrary slot occupancy', () => {
    const s = slab(Vec3, 5)
    s.insert() // slot 0
    s.insert() // slot 1
    // Slot 0 is occupied
    expect(s.has(s.get(0))).toBe(true)
    // Slot 2 is not occupied
    expect(s.has(s.get(2))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Nested struct — Particle
// ---------------------------------------------------------------------------

describe('slab — nested struct (Particle)', () => {
  const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
  const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })
  // Particle.sizeof = 24 + 24 + 4 + 4 = 56

  it('Particle.sizeof is 56', () => {
    expect(Particle.sizeof).toBe(56)
  })

  it('insert 3 particles with distinct pos.x and id round-trip correctly', () => {
    const s = slab(Particle, 100)

    // Insert particle 0
    const h0 = s.insert() as any
    h0.pos.x = 1.0
    h0.id = 100

    // Insert particle 1 — handle rebased to slot 1
    const h1 = s.insert() as any
    h1.pos.x = 2.0
    h1.id = 200

    // Insert particle 2
    const h2 = s.insert() as any
    h2.pos.x = 3.0
    h2.id = 300

    // Read back via get() — handle is rebased each time
    expect((s.get(0) as any).pos.x).toBe(1.0)
    expect((s.get(0) as any).id).toBe(100)
    expect((s.get(1) as any).pos.x).toBe(2.0)
    expect((s.get(1) as any).id).toBe(200)
    expect((s.get(2) as any).pos.x).toBe(3.0)
    expect((s.get(2) as any).id).toBe(300)
  })

  it('slot 1 pos.x is at raw byte offset 56 in the DataView', () => {
    const s = slab(Particle, 100)
    s.insert() // slot 0
    const h1 = s.insert() as any
    h1.pos.x = 99.5

    // Slot 1 starts at byte 56 (sizeof=56). pos.x is at offset 0 within the slot.
    const view = new DataView(s.buffer)
    expect(view.getFloat64(56, true)).toBe(99.5)
  })
})

// ---------------------------------------------------------------------------
// Public export — slab IS exported from src/index.ts (wired up in task-4)
// ---------------------------------------------------------------------------

describe('public export', () => {
  it('pkg.slab is a function (wired up by task-4)', async () => {
    // Dynamic import to avoid type-level errors
    const pkg = await import('../../src/index.js')
    expect(typeof (pkg as any).slab).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Type annotation usability
// ---------------------------------------------------------------------------

describe('type annotation usability', () => {
  it('Slab<F> and Handle<F> are usable as type annotations', () => {
    const Vec3 = struct({ x: 'f64', y: 'f64' })
    const s: Slab<typeof Vec3['fields']> = slab(Vec3, 4)
    const h: Handle<typeof Vec3['fields']> = s.insert()
    expect(s.len).toBe(1)
    expect(h).toBeDefined()
  })
})
