import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { vec } from '../../src/vec/vec.js'

// ---------------------------------------------------------------------------
// Test structs
// ---------------------------------------------------------------------------

const Point2D = struct({ x: 'f64', y: 'f64' })
const Mixed = struct({ id: 'u32', life: 'f32' })

const Nested = struct({
  pos: struct({ x: 'f64', y: 'f64', z: 'f64' }),
  life: 'f32',
})

// ---------------------------------------------------------------------------
// Growth tests
// ---------------------------------------------------------------------------

describe('vec growth', () => {
  it('push beyond initial capacity triggers growth — capacity doubles', () => {
    const v = vec(Point2D, 4)
    for (let i = 0; i < 4; i++) v.push()
    expect(v.capacity).toBe(4)
    // 5th push triggers growth
    v.push()
    expect(v.capacity).toBe(8)
    expect(v.len).toBe(5)
  })

  it('after growth, previously pushed values are preserved', () => {
    const v = vec(Point2D, 2)
    const h0 = v.push()
    h0.x = 10.0
    h0.y = 20.0
    const h1 = v.push()
    h1.x = 30.0
    h1.y = 40.0

    // trigger growth
    v.push()

    const r0 = v.get(0)
    expect(r0.x).toBe(10.0)
    expect(r0.y).toBe(20.0)

    const r1 = v.get(1)
    expect(r1.x).toBe(30.0)
    expect(r1.y).toBe(40.0)
  })

  it('after growth, buffer is a new ArrayBuffer (different reference)', () => {
    const v = vec(Point2D, 2)
    v.push()
    v.push()
    const oldBuf = v.buffer
    // trigger growth
    v.push()
    expect(v.buffer).not.toBe(oldBuf)
  })

  it('after growth, column returns a new TypedArray (different reference)', () => {
    const v = vec(Point2D, 2)
    v.push()
    v.push()
    const oldCol = v.column('x')
    // trigger growth
    v.push()
    const newCol = v.column('x')
    expect(newCol).not.toBe(oldCol)
  })

  it('after growth, column("x").buffer === vec.buffer (same-buffer guarantee with new buffer)', () => {
    const v = vec(Point2D, 2)
    v.push()
    v.push()
    // trigger growth
    v.push()
    expect(v.column('x').buffer).toBe(v.buffer)
    expect(v.column('y').buffer).toBe(v.buffer)
  })

  it('growth from capacity 1: push 2 elements into vec(def, 1) succeeds, capacity becomes 2', () => {
    const v = vec(Point2D, 1)
    expect(v.capacity).toBe(1)
    v.push()
    // 2nd push triggers growth
    v.push()
    expect(v.capacity).toBe(2)
    expect(v.len).toBe(2)
  })

  it('multiple growth events: push 100 elements into vec(def, 4), verify all values preserved', () => {
    const v = vec(Point2D, 4)
    for (let i = 0; i < 100; i++) {
      const h = v.push()
      h.x = i * 2.0
      h.y = i * 3.0
    }
    expect(v.len).toBe(100)
    for (let i = 0; i < 100; i++) {
      const h = v.get(i)
      expect(h.x).toBe(i * 2.0)
      expect(h.y).toBe(i * 3.0)
    }
  })

  it('after multiple growth events, column length equals new capacity', () => {
    const v = vec(Point2D, 1)
    // push 4 elements: triggers growth at 1->2->4
    for (let i = 0; i < 4; i++) v.push()
    // capacity should be 4 (1->2->4)
    expect(v.capacity).toBe(4)
    expect(v.column('x').length).toBe(4)
    expect(v.column('y').length).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Column-ref invalidation tests
// ---------------------------------------------------------------------------

describe('vec column-ref invalidation after growth', () => {
  it('old column ref buffer is NOT the vec current buffer after growth', () => {
    const v = vec(Point2D, 2)
    v.push()
    v.push()
    const staleCol = v.column('x')
    const staleBuffer = v.buffer
    // trigger growth
    v.push()
    // stale references now point at old buffer
    expect(staleCol.buffer).not.toBe(v.buffer)
    expect(staleBuffer).not.toBe(v.buffer)
  })

  it('new column ref after growth points at new buffer', () => {
    const v = vec(Point2D, 2)
    v.push()
    v.push()
    // trigger growth
    v.push()
    const freshCol = v.column('x')
    expect(freshCol.buffer).toBe(v.buffer)
  })
})

// ---------------------------------------------------------------------------
// swapRemove tests
// ---------------------------------------------------------------------------

describe('vec swapRemove', () => {
  it('swapRemove(0) on a vec with 3 elements: element at 0 gets value from 2, len becomes 2', () => {
    const v = vec(Point2D, 4)
    const h0 = v.push(); h0.x = 1.0; h0.y = 10.0
    const h1 = v.push(); h1.x = 2.0; h1.y = 20.0
    const h2 = v.push(); h2.x = 3.0; h2.y = 30.0

    v.swapRemove(0)

    expect(v.len).toBe(2)
    const r0 = v.get(0)
    expect(r0.x).toBe(3.0)
    expect(r0.y).toBe(30.0)
    const r1 = v.get(1)
    expect(r1.x).toBe(2.0)
    expect(r1.y).toBe(20.0)
  })

  it('swapRemove(len-1) is equivalent to pop: len decrements, no data movement', () => {
    const v = vec(Point2D, 4)
    const h0 = v.push(); h0.x = 1.0; h0.y = 10.0
    const h1 = v.push(); h1.x = 2.0; h1.y = 20.0
    const h2 = v.push(); h2.x = 3.0; h2.y = 30.0

    v.swapRemove(2) // last element

    expect(v.len).toBe(2)
    const r0 = v.get(0)
    expect(r0.x).toBe(1.0)
    expect(r0.y).toBe(10.0)
    const r1 = v.get(1)
    expect(r1.x).toBe(2.0)
    expect(r1.y).toBe(20.0)
  })

  it('swapRemove on single-element vec: len becomes 0', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.swapRemove(0)
    expect(v.len).toBe(0)
  })

  it('swapRemove with out-of-range index throws "index out of range"', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    expect(() => v.swapRemove(2)).toThrow('index out of range')
    expect(() => v.swapRemove(-1)).toThrow('index out of range')
    expect(() => v.swapRemove(5)).toThrow('index out of range')
  })

  it('swapRemove after drop throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.drop()
    expect(() => v.swapRemove(0)).toThrow('vec has been dropped')
  })

  it('values at remaining indices are correct after swapRemove', () => {
    const v = vec(Point2D, 8)
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.x = i * 10.0
      h.y = i * 100.0
    }
    // Remove index 1 (x=10, y=100). Last element (index 4, x=40, y=400) moves to index 1.
    v.swapRemove(1)
    expect(v.len).toBe(4)

    expect(v.get(0).x).toBe(0.0)
    expect(v.get(0).y).toBe(0.0)
    expect(v.get(1).x).toBe(40.0)
    expect(v.get(1).y).toBe(400.0)
    expect(v.get(2).x).toBe(20.0)
    expect(v.get(2).y).toBe(200.0)
    expect(v.get(3).x).toBe(30.0)
    expect(v.get(3).y).toBe(300.0)
  })

  it('swapRemove works with nested struct fields', () => {
    const v = vec(Nested, 4)
    const h0 = v.push(); h0.pos.x = 1.0; h0.pos.y = 2.0; h0.pos.z = 3.0; h0.life = 0.1
    const h1 = v.push(); h1.pos.x = 4.0; h1.pos.y = 5.0; h1.pos.z = 6.0; h1.life = 0.2
    const h2 = v.push(); h2.pos.x = 7.0; h2.pos.y = 8.0; h2.pos.z = 9.0; h2.life = 0.3

    v.swapRemove(0)

    expect(v.len).toBe(2)
    const r0 = v.get(0)
    expect(r0.pos.x).toBe(7.0)
    expect(r0.pos.y).toBe(8.0)
    expect(r0.pos.z).toBe(9.0)
    expect(r0.life).toBeCloseTo(0.3)
  })

  it('swapRemove on empty vec throws "index out of range"', () => {
    const v = vec(Point2D, 4)
    expect(() => v.swapRemove(0)).toThrow('index out of range')
  })
})

// ---------------------------------------------------------------------------
// remove tests
// ---------------------------------------------------------------------------

describe('vec remove', () => {
  it('remove(0) on [A, B, C]: result is [B, C], len = 2, order preserved', () => {
    const v = vec(Point2D, 4)
    const h0 = v.push(); h0.x = 1.0; h0.y = 10.0
    const h1 = v.push(); h1.x = 2.0; h1.y = 20.0
    const h2 = v.push(); h2.x = 3.0; h2.y = 30.0

    v.remove(0)

    expect(v.len).toBe(2)
    expect(v.get(0).x).toBe(2.0)
    expect(v.get(0).y).toBe(20.0)
    expect(v.get(1).x).toBe(3.0)
    expect(v.get(1).y).toBe(30.0)
  })

  it('remove(1) on [A, B, C]: result is [A, C], len = 2, order preserved', () => {
    const v = vec(Point2D, 4)
    const h0 = v.push(); h0.x = 1.0; h0.y = 10.0
    const h1 = v.push(); h1.x = 2.0; h1.y = 20.0
    const h2 = v.push(); h2.x = 3.0; h2.y = 30.0

    v.remove(1)

    expect(v.len).toBe(2)
    expect(v.get(0).x).toBe(1.0)
    expect(v.get(0).y).toBe(10.0)
    expect(v.get(1).x).toBe(3.0)
    expect(v.get(1).y).toBe(30.0)
  })

  it('remove(len-1) on [A, B, C]: result is [A, B], len = 2', () => {
    const v = vec(Point2D, 4)
    const h0 = v.push(); h0.x = 1.0; h0.y = 10.0
    const h1 = v.push(); h1.x = 2.0; h1.y = 20.0
    const h2 = v.push(); h2.x = 3.0; h2.y = 30.0

    v.remove(2)

    expect(v.len).toBe(2)
    expect(v.get(0).x).toBe(1.0)
    expect(v.get(0).y).toBe(10.0)
    expect(v.get(1).x).toBe(2.0)
    expect(v.get(1).y).toBe(20.0)
  })

  it('remove on single-element vec: len becomes 0', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.remove(0)
    expect(v.len).toBe(0)
  })

  it('remove with out-of-range index throws "index out of range"', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    expect(() => v.remove(2)).toThrow('index out of range')
    expect(() => v.remove(-1)).toThrow('index out of range')
    expect(() => v.remove(5)).toThrow('index out of range')
  })

  it('remove after drop throws "vec has been dropped"', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.drop()
    expect(() => v.remove(0)).toThrow('vec has been dropped')
  })

  it('remove on empty vec throws "index out of range"', () => {
    const v = vec(Point2D, 4)
    expect(() => v.remove(0)).toThrow('index out of range')
  })

  it('remove preserves order for larger sequence', () => {
    const v = vec(Point2D, 8)
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.x = i * 10.0
      h.y = i * 100.0
    }
    // Remove index 2 (x=20, y=200). Elements [3,4] shift left.
    v.remove(2)
    expect(v.len).toBe(4)

    expect(v.get(0).x).toBe(0.0)
    expect(v.get(1).x).toBe(10.0)
    expect(v.get(2).x).toBe(30.0)
    expect(v.get(3).x).toBe(40.0)
  })

  it('remove works with nested struct fields', () => {
    const v = vec(Nested, 4)
    const h0 = v.push(); h0.pos.x = 1.0; h0.pos.y = 2.0; h0.pos.z = 3.0; h0.life = 0.1
    const h1 = v.push(); h1.pos.x = 4.0; h1.pos.y = 5.0; h1.pos.z = 6.0; h1.life = 0.2
    const h2 = v.push(); h2.pos.x = 7.0; h2.pos.y = 8.0; h2.pos.z = 9.0; h2.life = 0.3

    v.remove(1) // remove middle element

    expect(v.len).toBe(2)
    const r0 = v.get(0)
    expect(r0.pos.x).toBe(1.0)
    expect(r0.life).toBeCloseTo(0.1)
    const r1 = v.get(1)
    expect(r1.pos.x).toBe(7.0)
    expect(r1.life).toBeCloseTo(0.3)
  })

  it('mixed type: remove works correctly with u32 and f32 fields', () => {
    const v = vec(Mixed, 4)
    const h0 = v.push(); h0.id = 100; h0.life = 1.0
    const h1 = v.push(); h1.id = 200; h1.life = 2.0
    const h2 = v.push(); h2.id = 300; h2.life = 3.0

    v.remove(0)

    expect(v.len).toBe(2)
    expect(v.get(0).id).toBe(200)
    expect(v.get(0).life).toBeCloseTo(2.0)
    expect(v.get(1).id).toBe(300)
    expect(v.get(1).life).toBeCloseTo(3.0)
  })
})
