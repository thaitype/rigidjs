import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { vec } from '../../src/vec/vec.js'

// ---------------------------------------------------------------------------
// Test structs
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Point2D = struct({ x: 'f64', y: 'f64' })
const Mixed = struct({ id: 'u32', life: 'f32' })

const Nested = struct({
  pos: Vec3,
  life: 'f32',
})

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('vec construction', () => {
  it('creates vec with specified capacity, len starts at 0', () => {
    const v = vec(Point2D, 10)
    expect(v.len).toBe(0)
    expect(v.capacity).toBe(10)
  })

  it('default capacity is 16 when no second argument given', () => {
    const v = vec(Point2D)
    expect(v.capacity).toBe(16)
    expect(v.len).toBe(0)
  })

  it('buffer byteLength equals sizeofPerSlot * capacity', () => {
    const v = vec(Point2D, 8)
    // Point2D has 2 f64 fields = 16 bytes per slot; 8 slots = 128 bytes
    expect(v.buffer.byteLength).toBe(16 * 8)
  })

  it('buffer is an ArrayBuffer', () => {
    const v = vec(Point2D, 4)
    expect(v.buffer).toBeInstanceOf(ArrayBuffer)
  })
})

// ---------------------------------------------------------------------------
// push / len
// ---------------------------------------------------------------------------

describe('vec push', () => {
  it('push returns a handle', () => {
    const v = vec(Point2D, 4)
    const h = v.push()
    expect(h).toBeDefined()
    expect(typeof h.slot).toBe('number')
  })

  it('push increments len', () => {
    const v = vec(Point2D, 4)
    expect(v.len).toBe(0)
    v.push()
    expect(v.len).toBe(1)
    v.push()
    expect(v.len).toBe(2)
    v.push()
    expect(v.len).toBe(3)
  })

  it('handle.slot returns correct index after push', () => {
    const v = vec(Point2D, 4)
    const h = v.push()
    expect(h.slot).toBe(0)
    const h2 = v.push()
    expect(h2.slot).toBe(1)
  })

  it('handle fields are writable and readable', () => {
    const v = vec(Point2D, 4)
    const h = v.push()
    h.x = 3.14
    h.y = 2.71
    expect(h.x).toBeCloseTo(3.14)
    expect(h.y).toBeCloseTo(2.71)
  })

  it('grows automatically when len === capacity (no "vec is full" error)', () => {
    const v = vec(Point2D, 2)
    v.push()
    v.push()
    // Third push triggers growth — must not throw
    expect(() => v.push()).not.toThrow()
    expect(v.len).toBe(3)
    expect(v.capacity).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('vec get', () => {
  it('get(i) reads back correct field values for each pushed element', () => {
    const v = vec(Point2D, 4)
    const h0 = v.push()
    h0.x = 1.0
    h0.y = 2.0

    const h1 = v.push()
    h1.x = 3.0
    h1.y = 4.0

    // get() returns the SAME handle instance rebased to the index
    const r0 = v.get(0)
    expect(r0.x).toBe(1.0)
    expect(r0.y).toBe(2.0)

    const r1 = v.get(1)
    expect(r1.x).toBe(3.0)
    expect(r1.y).toBe(4.0)
  })

  it('handle.slot returns correct index after get', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    const h = v.get(1)
    expect(h.slot).toBe(1)
  })

  it('get throws "index out of range" when index >= len', () => {
    const v = vec(Point2D, 4)
    v.push()
    expect(() => v.get(1)).toThrow('index out of range')
    expect(() => v.get(5)).toThrow('index out of range')
  })

  it('get throws "index out of range" for negative index', () => {
    const v = vec(Point2D, 4)
    v.push()
    expect(() => v.get(-1)).toThrow('index out of range')
  })

  it('handle reuse: push and get return the SAME handle instance', () => {
    const v = vec(Point2D, 4)
    const h = v.push()
    const g = v.get(0)
    expect(h).toBe(g)
  })
})

// ---------------------------------------------------------------------------
// pop
// ---------------------------------------------------------------------------

describe('vec pop', () => {
  it('pop decrements len', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    expect(v.len).toBe(2)
    v.pop()
    expect(v.len).toBe(1)
    v.pop()
    expect(v.len).toBe(0)
  })

  it('pop throws "vec is empty" when len === 0', () => {
    const v = vec(Point2D, 4)
    expect(() => v.pop()).toThrow('vec is empty')
  })
})

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('vec clear', () => {
  it('clear resets len to 0', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    v.push()
    expect(v.len).toBe(3)
    v.clear()
    expect(v.len).toBe(0)
  })

  it('capacity is unchanged after clear', () => {
    const v = vec(Point2D, 8)
    v.push()
    v.clear()
    expect(v.capacity).toBe(8)
  })

  it('can push again after clear', () => {
    const v = vec(Point2D, 2)
    v.push()
    v.push()
    v.clear()
    v.push() // should not throw
    expect(v.len).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// drop
// ---------------------------------------------------------------------------

describe('vec drop', () => {
  it('drop then push throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.drop()
    expect(() => v.push()).toThrow('vec has been dropped')
  })

  it('drop then pop throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.drop()
    expect(() => v.pop()).toThrow('vec has been dropped')
  })

  it('drop then get throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.drop()
    expect(() => v.get(0)).toThrow('vec has been dropped')
  })

  it('drop then clear throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.drop()
    expect(() => v.clear()).toThrow('vec has been dropped')
  })

  it('drop then column throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.drop()
    expect(() => v.column('x')).toThrow('vec has been dropped')
  })

  it('drop then buffer throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.drop()
    expect(() => v.buffer).toThrow('vec has been dropped')
  })
})

// ---------------------------------------------------------------------------
// column
// ---------------------------------------------------------------------------

describe('vec column', () => {
  it('column returns a Float64Array for an f64 field', () => {
    const v = vec(Point2D, 4)
    const col = v.column('x')
    expect(col).toBeInstanceOf(Float64Array)
  })

  it('column.buffer === vec.buffer (same-buffer guarantee)', () => {
    const v = vec(Point2D, 4)
    const col = v.column('x')
    expect(col.buffer).toBe(v.buffer)
  })

  it('column length equals capacity', () => {
    const v = vec(Point2D, 8)
    expect(v.column('x').length).toBe(8)
    expect(v.column('y').length).toBe(8)
  })

  it('column write-through: column write is visible via handle', () => {
    const v = vec(Point2D, 4)
    v.push() // len = 1
    v.column('x')[0] = 42
    const h = v.get(0)
    expect(h.x).toBe(42)
  })

  it('handle write-through: handle write is visible via column', () => {
    const v = vec(Point2D, 4)
    const h = v.push()
    h.x = 99
    expect(v.column('x')[0]).toBe(99)
  })

  it('column throws "unknown column: nonexistent" for invalid name', () => {
    const v = vec(Point2D, 4)
    expect(() => v.column('nonexistent' as never)).toThrow('unknown column: nonexistent')
  })
})

// ---------------------------------------------------------------------------
// Nested struct fields
// ---------------------------------------------------------------------------

describe('vec nested struct fields', () => {
  it('push then nested field assignment works correctly', () => {
    const v = vec(Nested, 4)
    const h = v.push()
    h.pos.x = 1.0
    h.pos.y = 2.0
    h.pos.z = 3.0
    h.life = 0.5

    expect(h.pos.x).toBe(1.0)
    expect(h.pos.y).toBe(2.0)
    expect(h.pos.z).toBe(3.0)
    expect(h.life).toBeCloseTo(0.5)
  })

  it('column("pos.x") returns a Float64Array for nested f64 field', () => {
    const v = vec(Nested, 4)
    const col = v.column('pos.x')
    expect(col).toBeInstanceOf(Float64Array)
  })

  it('column("pos.x").buffer === vec.buffer for nested column', () => {
    const v = vec(Nested, 4)
    expect(v.column('pos.x').buffer).toBe(v.buffer)
  })

  it('nested column write-through: column write visible via handle', () => {
    const v = vec(Nested, 4)
    v.push()
    v.column('pos.x')[0] = 7.0
    const h = v.get(0)
    expect(h.pos.x).toBe(7.0)
  })

  it('multiple elements with nested structs are independent', () => {
    const v = vec(Nested, 4)

    const h0 = v.push()
    h0.pos.x = 10.0
    h0.pos.y = 20.0

    const h1 = v.push()
    h1.pos.x = 30.0
    h1.pos.y = 40.0

    // Verify element 0 is independent
    const r0 = v.get(0)
    expect(r0.pos.x).toBe(10.0)
    expect(r0.pos.y).toBe(20.0)

    const r1 = v.get(1)
    expect(r1.pos.x).toBe(30.0)
    expect(r1.pos.y).toBe(40.0)
  })
})

// ---------------------------------------------------------------------------
// Mixed types
// ---------------------------------------------------------------------------

describe('vec with mixed types', () => {
  it('u32 column returns Uint32Array', () => {
    const v = vec(Mixed, 4)
    expect(v.column('id')).toBeInstanceOf(Uint32Array)
  })

  it('f32 column returns Float32Array', () => {
    const v = vec(Mixed, 4)
    expect(v.column('life')).toBeInstanceOf(Float32Array)
  })

  it('u32 and f32 fields round-trip correctly', () => {
    const v = vec(Mixed, 4)
    const h = v.push()
    h.id = 42
    h.life = 0.75

    expect(h.id).toBe(42)
    expect(h.life).toBeCloseTo(0.75)
  })
})
