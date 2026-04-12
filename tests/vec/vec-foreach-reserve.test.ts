/**
 * Tests for vec.forEach(cb) and vec.reserve(n) — milestone-5 task-2.
 *
 * Covers:
 *   - forEach: visits all elements in order (0..len-1)
 *   - forEach: correct index argument
 *   - forEach: mutation of elements via handle
 *   - forEach: same handle instance reused at every step
 *   - forEach: empty vec calls cb zero times
 *   - forEach: after drop() throws
 *   - reserve: grows capacity without changing len
 *   - reserve: no-op when n <= capacity
 *   - reserve: data is preserved after growth
 *   - reserve: column refs are invalidated (new buffer allocated)
 *   - reserve: dropped vec throws
 *   - reserve: invalid n throws
 */

import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { vec } from '../../src/vec/vec.js'

// ---------------------------------------------------------------------------
// Test structs
// ---------------------------------------------------------------------------

const Point2D = struct({ x: 'f64', y: 'f64' })
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Nested = struct({ pos: Vec3, id: 'u32' })

// ---------------------------------------------------------------------------
// vec.forEach() — correctness
// ---------------------------------------------------------------------------

describe('vec — forEach()', () => {
  it('visits all elements in order 0..len-1', () => {
    const v = vec(Point2D, 8)
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
    const v = vec(Point2D, 6)
    for (let i = 0; i < 6; i++) v.push()

    const seen: number[] = []
    v.forEach((_h, idx) => { seen.push(idx) })

    expect(seen).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('handle.slot equals the index argument at every step', () => {
    const v = vec(Vec3, 4)
    for (let i = 0; i < 4; i++) v.push()

    v.forEach((h, idx) => {
      expect((h as any).slot).toBe(idx)
    })
  })

  it('allows mutation of elements via the handle', () => {
    const v = vec(Point2D, 4)
    for (let i = 0; i < 3; i++) {
      const h = v.push()
      h.x = i + 1
      h.y = 0
    }

    v.forEach((h) => {
      h.x += 100
    })

    expect((v.get(0) as any).x).toBe(101)
    expect((v.get(1) as any).x).toBe(102)
    expect((v.get(2) as any).x).toBe(103)
  })

  it('reuses the same handle instance at every step', () => {
    const v = vec(Point2D, 4)
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
    const v = vec(Point2D, 8)
    let count = 0
    v.forEach(() => { count++ })
    expect(count).toBe(0)
  })

  it('only iterates over live elements (respects len after pop)', () => {
    const v = vec(Point2D, 8)
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.x = i
    }
    v.pop()
    v.pop()
    // len is now 3

    const indices: number[] = []
    v.forEach((_h, idx) => { indices.push(idx) })
    expect(indices).toEqual([0, 1, 2])
  })

  it('works with nested struct handle', () => {
    const v = vec(Nested, 4)
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

  it('after drop() throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.drop()
    expect(() => v.forEach(() => {})).toThrow('vec has been dropped')
  })
})

// ---------------------------------------------------------------------------
// vec.reserve() — capacity management
// ---------------------------------------------------------------------------

describe('vec — reserve()', () => {
  it('grows capacity to exactly n when n > capacity', () => {
    const v = vec(Point2D, 4)
    expect(v.capacity).toBe(4)
    v.reserve(20)
    expect(v.capacity).toBe(20)
  })

  it('does not change len when growing', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    expect(v.len).toBe(2)
    v.reserve(100)
    expect(v.len).toBe(2)
  })

  it('is a no-op when n equals capacity', () => {
    const v = vec(Point2D, 16)
    const bufBefore = v.buffer
    v.reserve(16)
    // Capacity unchanged, same buffer (no growth happened).
    expect(v.capacity).toBe(16)
    expect(v.buffer).toBe(bufBefore)
  })

  it('is a no-op when n < capacity', () => {
    const v = vec(Point2D, 32)
    const bufBefore = v.buffer
    v.reserve(8)
    expect(v.capacity).toBe(32)
    expect(v.buffer).toBe(bufBefore)
  })

  it('preserves existing element data after growth', () => {
    const v = vec(Point2D, 4)
    for (let i = 0; i < 4; i++) {
      const h = v.push()
      h.x = i * 10
      h.y = i * -3
    }
    v.reserve(100)
    // All pre-reserve elements should still be readable via get().
    for (let i = 0; i < 4; i++) {
      const h = v.get(i) as any
      expect(h.x).toBe(i * 10)
      expect(h.y).toBe(i * -3)
    }
  })

  it('allows pushing up to the reserved capacity without re-growing', () => {
    const v = vec(Point2D, 4)
    v.reserve(50)
    expect(v.capacity).toBe(50)
    // Push to fill exactly to reserved capacity
    for (let i = 0; i < 50; i++) {
      v.push()
    }
    expect(v.len).toBe(50)
    expect(v.capacity).toBe(50)
  })

  it('invalidates old column refs after growth (new buffer)', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    const oldBuf = v.buffer
    const oldCol = v.column('x') as Float64Array
    v.reserve(100)
    const newBuf = v.buffer
    // Buffer must change on growth.
    expect(newBuf).not.toBe(oldBuf)
    // Old column view points at old (now stale) buffer.
    expect(oldCol.buffer).toBe(oldBuf)
    // New column view points at new buffer.
    const newCol = v.column('x') as Float64Array
    expect(newCol.buffer).toBe(newBuf)
  })

  it('after drop() throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.drop()
    expect(() => v.reserve(10)).toThrow('vec has been dropped')
  })

  it('throws for n = 0', () => {
    const v = vec(Point2D, 4)
    expect(() => v.reserve(0)).toThrow('vec.reserve: n must be a positive integer')
  })

  it('throws for negative n', () => {
    const v = vec(Point2D, 4)
    expect(() => v.reserve(-5)).toThrow('vec.reserve: n must be a positive integer')
  })

  it('throws for non-integer n', () => {
    const v = vec(Point2D, 4)
    expect(() => v.reserve(3.5)).toThrow('vec.reserve: n must be a positive integer')
  })

  it('throws for NaN', () => {
    const v = vec(Point2D, 4)
    expect(() => v.reserve(NaN)).toThrow('vec.reserve: n must be a positive integer')
  })
})
