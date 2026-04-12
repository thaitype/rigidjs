/**
 * Tests for slab.column() — the SoA column access API added in milestone-3 task-3.
 *
 * Covers:
 *   1. column('pos.x') returns a Float64Array of length `capacity`
 *   2. Mutations via handle are visible via column view
 *   3. Mutations via column view are visible via handle
 *   4. column('pos.x').buffer === slab.buffer (same ArrayBuffer)
 *   5. column('id') returns a Uint32Array (correct TypedArray subclass)
 *   6. column('unknown-name') throws "unknown column: unknown-name"
 *   7. After drop(), column() throws "slab has been dropped"
 *   8. column() is allocation-free (same reference returned on repeated calls)
 *   9. slab.buffer is stable (b1 === b2, single ArrayBuffer)
 *  10. Multi-field struct column types (all 8 numeric tokens)
 */

import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { slab } from '../../src/slab/slab.js'
import type { ColumnKey } from '../../src/types.js'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })

// ---------------------------------------------------------------------------
// 1. column() returns correct TypedArray type and length
// ---------------------------------------------------------------------------

describe('slab.column — basic return type and length', () => {
  it('column("pos.x") returns a Float64Array of length capacity', () => {
    const s = slab(Particle, 8)
    const col = s.column('pos.x')
    expect(col instanceof Float64Array).toBe(true)
    expect(col.length).toBe(8)
  })

  it('column("pos.y") returns a Float64Array of length capacity', () => {
    const s = slab(Particle, 16)
    const col = s.column('pos.y')
    expect(col instanceof Float64Array).toBe(true)
    expect(col.length).toBe(16)
  })

  it('column("life") returns a Float32Array', () => {
    const s = slab(Particle, 4)
    const col = s.column('life')
    expect(col instanceof Float32Array).toBe(true)
    expect(col.length).toBe(4)
  })

  it('column("id") returns a Uint32Array', () => {
    const s = slab(Particle, 4)
    const col = s.column('id')
    expect(col instanceof Uint32Array).toBe(true)
    expect(col.length).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 2. Mutations via handle are visible via column view
// ---------------------------------------------------------------------------

describe('slab.column — handle write visible via column read', () => {
  it('s.insert().pos.x = 42 is visible as column("pos.x")[0] === 42', () => {
    const s = slab(Particle, 4)
    const posX = s.column('pos.x')
    const h = s.insert() as { pos: { x: number } }
    h.pos.x = 42
    expect(posX[0]).toBe(42)
  })

  it('s.get(1).pos.x = 7.7 is visible as column("pos.x")[1] === 7.7', () => {
    const s = slab(Particle, 4)
    s.insert()
    s.insert()
    const posX = s.column('pos.x')
    const h = s.get(1) as { pos: { x: number } }
    h.pos.x = 7.7
    expect(posX[1]).toBe(7.7)
  })

  it('writing id field via handle is visible via column("id") view', () => {
    const s = slab(Particle, 4)
    const idCol = s.column('id')
    const h = s.insert() as { id: number }
    h.id = 9999
    expect(idCol[0]).toBe(9999)
  })
})

// ---------------------------------------------------------------------------
// 3. Mutations via column view are visible via handle
// ---------------------------------------------------------------------------

describe('slab.column — column write visible via handle read', () => {
  it('column("pos.x")[0] = 99 is visible as s.get(0).pos.x === 99', () => {
    const s = slab(Particle, 4)
    s.insert()
    const posX = s.column('pos.x')
    posX[0] = 99
    const h = s.get(0) as { pos: { x: number } }
    expect(h.pos.x).toBe(99)
  })

  it('column("id")[1] = 42 is visible as s.get(1).id === 42', () => {
    const s = slab(Particle, 4)
    s.insert()
    s.insert()
    const idCol = s.column('id')
    idCol[1] = 42
    const h = s.get(1) as { id: number }
    expect(h.id).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// 4. column().buffer === slab.buffer (same ArrayBuffer)
// ---------------------------------------------------------------------------

describe('slab.column — buffer identity', () => {
  it('column("pos.x").buffer === slab.buffer', () => {
    const s = slab(Particle, 4)
    expect(s.column('pos.x').buffer).toBe(s.buffer)
  })

  it('column("vel.z").buffer === slab.buffer', () => {
    const s = slab(Particle, 4)
    expect(s.column('vel.z').buffer).toBe(s.buffer)
  })

  it('column("life").buffer === slab.buffer', () => {
    const s = slab(Particle, 4)
    expect(s.column('life').buffer).toBe(s.buffer)
  })

  it('column("id").buffer === slab.buffer', () => {
    const s = slab(Particle, 4)
    expect(s.column('id').buffer).toBe(s.buffer)
  })

  it('all column views share the same buffer as slab.buffer', () => {
    const s = slab(Particle, 4)
    const buf = s.buffer
    const colKeys: ColumnKey<typeof Particle['fields']>[] = [
      'pos.x', 'pos.y', 'pos.z', 'vel.x', 'vel.y', 'vel.z', 'life', 'id',
    ]
    for (const key of colKeys) {
      expect(s.column(key).buffer).toBe(buf)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. slab.buffer is a stable single reference
// ---------------------------------------------------------------------------

describe('slab.buffer — single ArrayBuffer, stable identity', () => {
  it('slab.buffer returns the same reference on repeated access', () => {
    const s = slab(Particle, 4)
    const b1 = s.buffer
    const b2 = s.buffer
    expect(b1 === b2).toBe(true)
  })

  it('byteLength === sizeofPerSlot * capacity', () => {
    const s = slab(Particle, 10)
    // Particle.sizeof = 56; 56 * 10 = 560
    expect(s.buffer.byteLength).toBe(56 * 10)
  })
})

// ---------------------------------------------------------------------------
// 6. column() throws for unknown names
// ---------------------------------------------------------------------------

describe('slab.column — throws for unknown column names', () => {
  it('column("unknown-name") throws "unknown column: unknown-name"', () => {
    const s = slab(Particle, 4)
    // Cast required because "unknown-name" is not a valid ColumnKey<F>
    expect(() => (s as any).column('unknown-name')).toThrow('unknown column: unknown-name')
  })

  it('column("pos") throws (not a leaf column — "pos" is a nested struct)', () => {
    const s = slab(Particle, 4)
    expect(() => (s as any).column('pos')).toThrow('unknown column: pos')
  })
})

// ---------------------------------------------------------------------------
// 7. After drop(), column() throws "slab has been dropped"
// ---------------------------------------------------------------------------

describe('slab.column — throws after drop()', () => {
  it('column("pos.x") throws "slab has been dropped" after drop()', () => {
    const s = slab(Particle, 4)
    s.drop()
    expect(() => s.column('pos.x')).toThrow('slab has been dropped')
  })
})

// ---------------------------------------------------------------------------
// 8. column() is allocation-free (returns same pre-built reference)
// ---------------------------------------------------------------------------

describe('slab.column — allocation-free (same reference on repeated calls)', () => {
  it('calling column("pos.x") 1000 times returns the same reference each time', () => {
    const s = slab(Particle, 4)
    const ref1 = s.column('pos.x')
    // Call 1000 times, check the reference is always the same object
    for (let i = 0; i < 1000; i++) {
      const ref = s.column('pos.x')
      expect(ref === ref1).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 9. Simple flat struct column access
// ---------------------------------------------------------------------------

describe('slab.column — flat struct (no nested fields)', () => {
  const V2 = struct({ x: 'f64', y: 'f64' })

  it('column("x") returns Float64Array of length capacity', () => {
    const s = slab(V2, 4)
    const col = s.column('x')
    expect(col instanceof Float64Array).toBe(true)
    expect(col.length).toBe(4)
  })

  it('write via insert() visible via column("x")', () => {
    const s = slab(V2, 4)
    const xs = s.column('x')
    const h = s.insert() as { x: number }
    h.x = 42
    expect(xs[0]).toBe(42)
  })

  it('write via column visible via get()', () => {
    const s = slab(V2, 4)
    s.insert()
    const xs = s.column('x')
    xs[0] = 99
    expect((s.get(0) as { x: number }).x).toBe(99)
  })
})

// ---------------------------------------------------------------------------
// 10. Multi-field struct with all 8 numeric types
// ---------------------------------------------------------------------------

describe('slab.column — all 8 numeric types', () => {
  const AllTypes = struct({
    a: 'f64',
    b: 'f32',
    c: 'u32',
    d: 'u16',
    e: 'u8',
    f: 'i32',
    g: 'i16',
    h: 'i8',
  })

  it('column("a") returns Float64Array', () => {
    const s = slab(AllTypes, 4)
    expect(s.column('a') instanceof Float64Array).toBe(true)
  })
  it('column("b") returns Float32Array', () => {
    const s = slab(AllTypes, 4)
    expect(s.column('b') instanceof Float32Array).toBe(true)
  })
  it('column("c") returns Uint32Array', () => {
    const s = slab(AllTypes, 4)
    expect(s.column('c') instanceof Uint32Array).toBe(true)
  })
  it('column("d") returns Uint16Array', () => {
    const s = slab(AllTypes, 4)
    expect(s.column('d') instanceof Uint16Array).toBe(true)
  })
  it('column("e") returns Uint8Array', () => {
    const s = slab(AllTypes, 4)
    expect(s.column('e') instanceof Uint8Array).toBe(true)
  })
  it('column("f") returns Int32Array', () => {
    const s = slab(AllTypes, 4)
    expect(s.column('f') instanceof Int32Array).toBe(true)
  })
  it('column("g") returns Int16Array', () => {
    const s = slab(AllTypes, 4)
    expect(s.column('g') instanceof Int16Array).toBe(true)
  })
  it('column("h") returns Int8Array', () => {
    const s = slab(AllTypes, 4)
    expect(s.column('h') instanceof Int8Array).toBe(true)
  })
})
