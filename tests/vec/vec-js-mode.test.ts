/**
 * Tests for vec JS mode — milestone-7 task-2.
 *
 * When vec(def) is called with no capacity, the vec starts in JS mode:
 * plain JS objects backed by a regular Array, with a JSHandle wrapping them.
 *
 * Covers:
 *   - vec without capacity starts in JS mode
 *   - vec with capacity starts in SoA mode (existing behavior preserved)
 *   - push: creates JS objects, returns JSHandle
 *   - pop: removes last element
 *   - get: returns JSHandle for item at index
 *   - get out of range throws
 *   - swapRemove: O(1) removal, last element moves to removed index
 *   - remove: order-preserving removal
 *   - clear: resets len to 0
 *   - drop: nulls out _items, all ops throw afterwards
 *   - forEach: visits all elements in order
 *   - for..of: visits all elements via iterator
 *   - handle reuse: same JSHandle instance returned every time
 *   - nested struct field access (h.pos.x, h.pos.y, etc.)
 *   - field read/write correctness
 *   - capacity === len in JS mode (JS arrays grow automatically)
 *   - buffer throws in JS mode
 *   - reserve is a no-op in JS mode (no throw, no change)
 */

import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { vec } from '../../src/vec/vec.js'

// ---------------------------------------------------------------------------
// Test structs
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Point2D = struct({ x: 'f64', y: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })
const Nested = struct({ pos: Vec3, id: 'u32' })

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

describe('vec JS mode — mode selection', () => {
  it('vec(def) with no capacity starts in JS mode (capacity === 0 initially)', () => {
    const v = vec(Point2D)
    // In JS mode, capacity tracks len (JS arrays have no fixed capacity)
    expect(v.capacity).toBe(0)
    expect(v.len).toBe(0)
  })

  it('vec(def, capacity) starts in SoA mode (capacity is fixed)', () => {
    const v = vec(Point2D, 8)
    expect(v.capacity).toBe(8)
    expect(v.len).toBe(0)
    // buffer is available in SoA mode
    expect(v.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('buffer throws in JS mode', () => {
    const v = vec(Point2D)
    expect(() => v.buffer).toThrow('buffer not available in JS mode')
  })

  it('column() in JS mode triggers graduation (no longer throws)', () => {
    const v = vec(Point2D)
    // column() in JS mode graduates the vec first, then returns the TypedArray
    const col = v.column('x')
    expect(col).toBeInstanceOf(Float64Array)
    expect(v.isGraduated).toBe(true)
  })

  it('reserve is a no-op in JS mode (does not throw)', () => {
    const v = vec(Point2D)
    expect(() => v.reserve(100)).not.toThrow()
    expect(v.len).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// push / len / capacity
// ---------------------------------------------------------------------------

describe('vec JS mode — push / len / capacity', () => {
  it('push returns a handle with a slot getter', () => {
    const v = vec(Point2D)
    const h = v.push()
    expect(h).toBeDefined()
    expect(typeof h.slot).toBe('number')
  })

  it('push increments len', () => {
    const v = vec(Point2D)
    expect(v.len).toBe(0)
    v.push()
    expect(v.len).toBe(1)
    v.push()
    expect(v.len).toBe(2)
    v.push()
    expect(v.len).toBe(3)
  })

  it('capacity tracks len in JS mode', () => {
    const v = vec(Point2D)
    expect(v.capacity).toBe(0)
    v.push()
    expect(v.capacity).toBe(1)
    v.push()
    expect(v.capacity).toBe(2)
  })

  it('push slot matches the index of the new element', () => {
    const v = vec(Point2D)
    const h0 = v.push()
    expect(h0.slot).toBe(0)
    const h1 = v.push()
    expect(h1.slot).toBe(1)
    const h2 = v.push()
    expect(h2.slot).toBe(2)
  })

  it('handle fields are writable and readable after push', () => {
    const v = vec(Point2D)
    const h = v.push()
    h.x = 3.14
    h.y = 2.71
    expect(h.x).toBeCloseTo(3.14)
    expect(h.y).toBeCloseTo(2.71)
  })

  it('can push many items without error (JS array grows automatically)', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 200; i++) {
      v.push()
    }
    expect(v.len).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('vec JS mode — get', () => {
  it('get(i) reads back correct field values for each pushed element', () => {
    const v = vec(Point2D)
    const h0 = v.push()
    h0.x = 1.0
    h0.y = 2.0

    const h1 = v.push()
    h1.x = 3.0
    h1.y = 4.0

    const r0 = v.get(0)
    expect(r0.x).toBe(1.0)
    expect(r0.y).toBe(2.0)

    const r1 = v.get(1)
    expect(r1.x).toBe(3.0)
    expect(r1.y).toBe(4.0)
  })

  it('handle.slot returns the correct index after get', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    const h = v.get(1)
    expect(h.slot).toBe(1)
  })

  it('get throws "index out of range" when index >= len', () => {
    const v = vec(Point2D)
    v.push()
    expect(() => v.get(1)).toThrow('index out of range')
    expect(() => v.get(5)).toThrow('index out of range')
  })

  it('get throws "index out of range" for negative index', () => {
    const v = vec(Point2D)
    v.push()
    expect(() => v.get(-1)).toThrow('index out of range')
  })

  it('handle reuse: push and get return the SAME handle instance', () => {
    const v = vec(Point2D)
    const h = v.push()
    const g = v.get(0)
    expect(h).toBe(g)
  })

  it('multiple get calls return the same handle instance', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    const a = v.get(0)
    const b = v.get(1)
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// pop
// ---------------------------------------------------------------------------

describe('vec JS mode — pop', () => {
  it('pop decrements len', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    expect(v.len).toBe(2)
    v.pop()
    expect(v.len).toBe(1)
    v.pop()
    expect(v.len).toBe(0)
  })

  it('pop throws "vec is empty" when len === 0', () => {
    const v = vec(Point2D)
    expect(() => v.pop()).toThrow('vec is empty')
  })

  it('element is inaccessible after pop (index out of range)', () => {
    const v = vec(Point2D)
    v.push()
    v.pop()
    expect(() => v.get(0)).toThrow('index out of range')
  })
})

// ---------------------------------------------------------------------------
// swapRemove
// ---------------------------------------------------------------------------

describe('vec JS mode — swapRemove', () => {
  it('swapRemove moves last element to removed index', () => {
    const v = vec(Point2D)
    const h0 = v.push(); h0.x = 10; h0.y = 10
    const h1 = v.push(); h1.x = 20; h1.y = 20
    const h2 = v.push(); h2.x = 30; h2.y = 30

    // Remove index 0: last element (30,30) moves to index 0
    v.swapRemove(0)
    expect(v.len).toBe(2)

    const r0 = v.get(0)
    expect(r0.x).toBe(30)
    expect(r0.y).toBe(30)

    const r1 = v.get(1)
    expect(r1.x).toBe(20)
    expect(r1.y).toBe(20)
  })

  it('swapRemove on last element is equivalent to pop', () => {
    const v = vec(Point2D)
    const h0 = v.push(); h0.x = 1; h0.y = 2
    const h1 = v.push(); h1.x = 3; h1.y = 4

    v.swapRemove(1) // remove last
    expect(v.len).toBe(1)
    const r = v.get(0)
    expect(r.x).toBe(1)
    expect(r.y).toBe(2)
  })

  it('swapRemove throws "index out of range" for invalid index', () => {
    const v = vec(Point2D)
    v.push()
    expect(() => v.swapRemove(1)).toThrow('index out of range')
    expect(() => v.swapRemove(-1)).toThrow('index out of range')
  })
})

// ---------------------------------------------------------------------------
// remove (order-preserving)
// ---------------------------------------------------------------------------

describe('vec JS mode — remove', () => {
  it('remove shifts remaining elements left (order preserved)', () => {
    const v = vec(Point2D)
    const h0 = v.push(); h0.x = 10
    const h1 = v.push(); h1.x = 20
    const h2 = v.push(); h2.x = 30
    const h3 = v.push(); h3.x = 40

    v.remove(1) // remove index 1 (x=20)
    expect(v.len).toBe(3)
    expect(v.get(0).x).toBe(10)
    expect(v.get(1).x).toBe(30)
    expect(v.get(2).x).toBe(40)
  })

  it('remove first element shifts all others', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 4; i++) { const h = v.push(); h.x = (i + 1) * 10 }

    v.remove(0)
    expect(v.len).toBe(3)
    expect(v.get(0).x).toBe(20)
    expect(v.get(1).x).toBe(30)
    expect(v.get(2).x).toBe(40)
  })

  it('remove throws "index out of range" for invalid index', () => {
    const v = vec(Point2D)
    v.push()
    expect(() => v.remove(1)).toThrow('index out of range')
    expect(() => v.remove(-1)).toThrow('index out of range')
  })
})

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('vec JS mode — clear', () => {
  it('clear resets len to 0', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    v.push()
    v.clear()
    expect(v.len).toBe(0)
  })

  it('can push again after clear', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    v.clear()
    v.push()
    expect(v.len).toBe(1)
  })

  it('capacity is 0 after clear (len === capacity in JS mode)', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    v.clear()
    expect(v.capacity).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// drop
// ---------------------------------------------------------------------------

describe('vec JS mode — drop', () => {
  it('drop then push throws "vec has been dropped"', () => {
    const v = vec(Point2D)
    v.drop()
    expect(() => v.push()).toThrow('vec has been dropped')
  })

  it('drop then pop throws "vec has been dropped"', () => {
    const v = vec(Point2D)
    v.push()
    v.drop()
    expect(() => v.pop()).toThrow('vec has been dropped')
  })

  it('drop then get throws "vec has been dropped"', () => {
    const v = vec(Point2D)
    v.push()
    v.drop()
    expect(() => v.get(0)).toThrow('vec has been dropped')
  })

  it('drop then clear throws "vec has been dropped"', () => {
    const v = vec(Point2D)
    v.drop()
    expect(() => v.clear()).toThrow('vec has been dropped')
  })

  it('drop then forEach throws "vec has been dropped"', () => {
    const v = vec(Point2D)
    v.push()
    v.drop()
    expect(() => v.forEach(() => {})).toThrow('vec has been dropped')
  })

  it('drop then swapRemove throws "vec has been dropped"', () => {
    const v = vec(Point2D)
    v.push()
    v.drop()
    expect(() => v.swapRemove(0)).toThrow('vec has been dropped')
  })

  it('drop then remove throws "vec has been dropped"', () => {
    const v = vec(Point2D)
    v.push()
    v.drop()
    expect(() => v.remove(0)).toThrow('vec has been dropped')
  })
})

// ---------------------------------------------------------------------------
// forEach
// ---------------------------------------------------------------------------

describe('vec JS mode — forEach', () => {
  it('visits all elements in order 0..len-1', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.x = i * 10
      h.y = i * -5
    }

    const indices: number[] = []
    const xs: number[] = []
    v.forEach((h, idx) => {
      indices.push(idx)
      xs.push(h.x)
    })

    expect(indices).toEqual([0, 1, 2, 3, 4])
    expect(xs).toEqual([0, 10, 20, 30, 40])
  })

  it('index argument matches the element position', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 6; i++) v.push()

    const seen: number[] = []
    v.forEach((_h, idx) => { seen.push(idx) })

    expect(seen).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('allows mutation of elements via the handle', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 3; i++) {
      const h = v.push()
      h.x = i + 1
      h.y = 0
    }

    v.forEach((h) => {
      h.x += 100
    })

    expect(v.get(0).x).toBe(101)
    expect(v.get(1).x).toBe(102)
    expect(v.get(2).x).toBe(103)
  })

  it('reuses the same handle instance at every step', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    v.push()

    const seen: object[] = []
    v.forEach((h) => { seen.push(h) })

    expect(seen.length).toBe(3)
    expect(seen[0] === seen[1]).toBe(true)
    expect(seen[1] === seen[2]).toBe(true)
  })

  it('empty vec: cb is never called', () => {
    const v = vec(Point2D)
    let count = 0
    v.forEach(() => { count++ })
    expect(count).toBe(0)
  })

  it('handle.slot equals the index argument at every step', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 4; i++) v.push()

    v.forEach((h, idx) => {
      expect((h as any).slot).toBe(idx)
    })
  })

  it('after drop() throws "vec has been dropped"', () => {
    const v = vec(Point2D)
    v.push()
    v.drop()
    expect(() => v.forEach(() => {})).toThrow('vec has been dropped')
  })
})

// ---------------------------------------------------------------------------
// for..of iterator
// ---------------------------------------------------------------------------

describe('vec JS mode — for..of iterator', () => {
  it('visits all elements in order', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 4; i++) {
      const h = v.push()
      h.x = i * 5
      h.y = i * 2
    }

    const results: { x: number; y: number }[] = []
    for (const h of v) {
      results.push({ x: h.x, y: h.y })
    }

    expect(results).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 2 },
      { x: 10, y: 4 },
      { x: 15, y: 6 },
    ])
  })

  it('empty vec: iterator yields nothing', () => {
    const v = vec(Point2D)
    let count = 0
    for (const _h of v) { count++ }
    expect(count).toBe(0)
  })

  it('for..of reuses the same handle instance each step', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    v.push()

    const handles: object[] = []
    for (const h of v) { handles.push(h) }

    expect(handles.length).toBe(3)
    expect(handles[0] === handles[1]).toBe(true)
    expect(handles[1] === handles[2]).toBe(true)
  })

  it('for..of slot matches position', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 3; i++) v.push()

    let idx = 0
    for (const h of v) {
      expect((h as any).slot).toBe(idx)
      idx++
    }
  })
})

// ---------------------------------------------------------------------------
// Nested struct field access
// ---------------------------------------------------------------------------

describe('vec JS mode — nested struct fields', () => {
  it('push then nested field assignment works correctly', () => {
    const v = vec(Nested)
    const h = v.push()
    h.pos.x = 1.0
    h.pos.y = 2.0
    h.pos.z = 3.0
    h.id = 42

    expect(h.pos.x).toBe(1.0)
    expect(h.pos.y).toBe(2.0)
    expect(h.pos.z).toBe(3.0)
    expect(h.id).toBe(42)
  })

  it('get(i) returns handle with correct nested field values', () => {
    const v = vec(Nested)
    const h = v.push()
    h.pos.x = 10.0
    h.pos.y = 20.0
    h.pos.z = 30.0
    h.id = 99

    const r = v.get(0)
    expect(r.pos.x).toBe(10.0)
    expect(r.pos.y).toBe(20.0)
    expect(r.pos.z).toBe(30.0)
    expect(r.id).toBe(99)
  })

  it('multiple elements with nested structs are independent', () => {
    const v = vec(Nested)

    const h0 = v.push()
    h0.pos.x = 10.0
    h0.pos.y = 20.0

    const h1 = v.push()
    h1.pos.x = 30.0
    h1.pos.y = 40.0

    const r0 = v.get(0)
    expect(r0.pos.x).toBe(10.0)
    expect(r0.pos.y).toBe(20.0)

    const r1 = v.get(1)
    expect(r1.pos.x).toBe(30.0)
    expect(r1.pos.y).toBe(40.0)
  })

  it('deeply nested struct (Particle) field access works', () => {
    const v = vec(Particle)
    const h = v.push()
    h.pos.x = 100.0
    h.pos.y = 200.0
    h.pos.z = 300.0
    h.vel.x = 1.0
    h.vel.y = -9.8
    h.vel.z = 0.0
    h.life = 0.75
    h.id = 7

    expect(h.pos.x).toBe(100.0)
    expect(h.pos.y).toBe(200.0)
    expect(h.pos.z).toBe(300.0)
    expect(h.vel.x).toBe(1.0)
    expect(h.vel.y).toBeCloseTo(-9.8)
    expect(h.vel.z).toBe(0.0)
    expect(h.life).toBeCloseTo(0.75)
    expect(h.id).toBe(7)
  })

  it('forEach with nested structs: can read and write nested fields', () => {
    const v = vec(Nested)
    for (let i = 0; i < 3; i++) {
      const h = v.push()
      h.pos.x = i * 1.0
      h.pos.y = i * 2.0
      h.pos.z = i * 3.0
      h.id = i + 10
    }

    const results: { x: number; y: number; z: number; id: number }[] = []
    v.forEach((h) => {
      results.push({ x: h.pos.x, y: h.pos.y, z: h.pos.z, id: h.id })
    })

    expect(results).toEqual([
      { x: 0, y: 0, z: 0, id: 10 },
      { x: 1, y: 2, z: 3, id: 11 },
      { x: 2, y: 4, z: 6, id: 12 },
    ])
  })

  it('for..of with nested struct fields works', () => {
    const v = vec(Nested)
    for (let i = 0; i < 2; i++) {
      const h = v.push()
      h.pos.x = i * 5.0
      h.id = i
    }

    const xs: number[] = []
    for (const h of v) {
      xs.push(h.pos.x)
    }

    expect(xs).toEqual([0, 5])
  })
})

// ---------------------------------------------------------------------------
// JS objects initialized with zero values
// ---------------------------------------------------------------------------

describe('vec JS mode — zero-initialized fields', () => {
  it('newly pushed elements have all fields initialized to 0', () => {
    const v = vec(Point2D)
    const h = v.push()
    expect(h.x).toBe(0)
    expect(h.y).toBe(0)
  })

  it('nested fields initialized to 0 after push', () => {
    const v = vec(Particle)
    const h = v.push()
    expect(h.pos.x).toBe(0)
    expect(h.pos.y).toBe(0)
    expect(h.pos.z).toBe(0)
    expect(h.vel.x).toBe(0)
    expect(h.vel.y).toBe(0)
    expect(h.vel.z).toBe(0)
    expect(h.life).toBe(0)
    expect(h.id).toBe(0)
  })
})
