/**
 * Tests for vec graduation logic — milestone-7 task-3.
 *
 * Graduation is the one-way transition from JS mode (plain JS objects)
 * to SoA mode (TypedArray columns). It can be triggered:
 *  - Automatically: when len >= 128 during push()
 *  - By calling .column() in JS mode
 *  - By calling .graduate() explicitly
 *
 * After graduation:
 *  - All data pushed in JS mode is preserved and readable
 *  - All SoA operations (push, get, forEach, swapRemove, remove, column, buffer) work
 *  - Mode never reverts to 'js' even if items are removed
 *
 * Covers:
 *   - Push below threshold: mode stays 'js'
 *   - Push to threshold (128): auto-graduation, mode switches to 'soa'
 *   - Data integrity: all values set in JS mode are readable after graduation
 *   - Nested struct data survives graduation
 *   - .column() triggers graduation from JS mode
 *   - .graduate() forces graduation at any len
 *   - .graduate() is a no-op if already SoA
 *   - .mode and .isGraduated report correct state
 *   - Post-graduation push/get/forEach/swapRemove/remove work (SoA path)
 *   - Post-graduation column() returns TypedArray without re-graduating
 *   - Post-graduation buffer is accessible
 *   - Graduation is one-way: removing items below threshold does NOT degrade
 *   - vec with capacity starts in SoA mode (no graduation needed)
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
// .mode and .isGraduated before graduation
// ---------------------------------------------------------------------------

describe('vec graduation — mode and isGraduated', () => {
  it('starts in JS mode when no capacity given', () => {
    const v = vec(Point2D)
    expect(v.mode).toBe('js')
    expect(v.isGraduated).toBe(false)
  })

  it('starts in SoA mode when capacity is given', () => {
    const v = vec(Point2D, 8)
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
  })

  it('mode stays js below graduation threshold', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 127; i++) {
      v.push()
    }
    expect(v.mode).toBe('js')
    expect(v.isGraduated).toBe(false)
    expect(v.len).toBe(127)
  })

  it('mode switches to soa when len reaches 128', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 128; i++) {
      v.push()
    }
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
    expect(v.len).toBe(128)
  })

  it('mode is soa after graduation stays soa even when items removed below threshold', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 128; i++) {
      v.push()
    }
    // Graduated at len=128
    for (let i = 0; i < 100; i++) {
      v.pop()
    }
    // len is now 28 — below threshold — but still SoA
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
    expect(v.len).toBe(28)
  })
})

// ---------------------------------------------------------------------------
// Auto-graduation via push()
// ---------------------------------------------------------------------------

describe('vec graduation — auto-graduation via push()', () => {
  it('push at position 127 keeps JS mode, push at 128 graduates', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 127; i++) {
      v.push()
    }
    expect(v.mode).toBe('js')

    v.push() // 128th push — triggers graduation
    expect(v.mode).toBe('soa')
    expect(v.len).toBe(128)
  })

  it('after auto-graduation, push continues to work in SoA mode', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 200; i++) {
      const h = v.push()
      h.x = i
      h.y = i * 2
    }
    expect(v.mode).toBe('soa')
    expect(v.len).toBe(200)
  })

  it('handle returned from the graduation-triggering push is a valid SoA handle', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 127; i++) {
      const h = v.push()
      h.x = i
      h.y = i * -1
    }
    // The 128th push triggers graduation
    const h = v.push()
    h.x = 999
    h.y = -999
    expect(v.mode).toBe('soa')
    // h should be a SoA handle pointing at slot 127
    expect(h.slot).toBe(127)
    expect(h.x).toBeCloseTo(999)
    expect(h.y).toBeCloseTo(-999)
  })
})

// ---------------------------------------------------------------------------
// Data integrity across graduation
// ---------------------------------------------------------------------------

describe('vec graduation — data integrity', () => {
  it('all values set in JS mode are readable after auto-graduation', () => {
    const v = vec(Point2D)
    const N = 128

    for (let i = 0; i < N; i++) {
      const h = v.push()
      h.x = i * 1.5
      h.y = i * -2.5
    }

    // Should be graduated at this point
    expect(v.mode).toBe('soa')

    for (let i = 0; i < N; i++) {
      const h = v.get(i)
      expect(h.x).toBeCloseTo(i * 1.5)
      expect(h.y).toBeCloseTo(i * -2.5)
    }
  })

  it('nested struct data survives graduation', () => {
    const v = vec(Nested)
    const N = 128

    for (let i = 0; i < N; i++) {
      const h = v.push()
      h.pos.x = i * 1.0
      h.pos.y = i * 2.0
      h.pos.z = i * 3.0
      h.id = i + 1
    }

    expect(v.mode).toBe('soa')

    for (let i = 0; i < N; i++) {
      const h = v.get(i)
      expect(h.pos.x).toBeCloseTo(i * 1.0)
      expect(h.pos.y).toBeCloseTo(i * 2.0)
      expect(h.pos.z).toBeCloseTo(i * 3.0)
      expect(h.id).toBe(i + 1)
    }
  })

  it('complex nested struct (Particle) data survives graduation', () => {
    const v = vec(Particle)

    for (let i = 0; i < 128; i++) {
      const h = v.push()
      h.pos.x = i * 100.0
      h.pos.y = i * 200.0
      h.pos.z = i * 300.0
      h.vel.x = i * 1.0
      h.vel.y = i * -9.8
      h.vel.z = 0.0
      h.life = i * 0.01
      h.id = i
    }

    expect(v.mode).toBe('soa')

    for (let i = 0; i < 128; i++) {
      const h = v.get(i)
      expect(h.pos.x).toBeCloseTo(i * 100.0)
      expect(h.pos.y).toBeCloseTo(i * 200.0)
      expect(h.pos.z).toBeCloseTo(i * 300.0)
      expect(h.vel.x).toBeCloseTo(i * 1.0)
      expect(h.vel.y).toBeCloseTo(i * -9.8)
      expect(h.vel.z).toBeCloseTo(0.0)
      expect(h.life).toBeCloseTo(i * 0.01, 5)
      expect(h.id).toBe(i)
    }
  })

  it('zero-initialized items (all fields = 0) survive graduation', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 128; i++) {
      v.push() // all fields are 0, not explicitly set
    }

    expect(v.mode).toBe('soa')

    for (let i = 0; i < 128; i++) {
      const h = v.get(i)
      expect(h.x).toBe(0)
      expect(h.y).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// .column() triggers graduation
// ---------------------------------------------------------------------------

describe('vec graduation — .column() triggers graduation', () => {
  it('column() in JS mode with 0 elements graduates and returns TypedArray', () => {
    const v = vec(Point2D)
    expect(v.mode).toBe('js')
    const col = v.column('x')
    expect(v.mode).toBe('soa')
    expect(col).toBeInstanceOf(Float64Array)
  })

  it('column() in JS mode with some elements graduates and preserves data', () => {
    const v = vec(Point2D)
    const h0 = v.push(); h0.x = 10; h0.y = 20
    const h1 = v.push(); h1.x = 30; h1.y = 40

    expect(v.mode).toBe('js')
    const colX = v.column('x')
    expect(v.mode).toBe('soa')
    expect(colX).toBeInstanceOf(Float64Array)
    expect(colX[0]).toBeCloseTo(10)
    expect(colX[1]).toBeCloseTo(30)
  })

  it('column() after graduation returns TypedArray without re-graduating', () => {
    const v = vec(Point2D)
    v.graduate() // force graduate with 0 items

    expect(v.mode).toBe('soa')
    const col = v.column('x')
    expect(col).toBeInstanceOf(Float64Array)
    expect(v.mode).toBe('soa')
  })

  it('column() with nested struct path triggers graduation and returns correct TypedArray', () => {
    const v = vec(Nested)
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.pos.x = i * 10.0
    }

    const colPosX = v.column('pos.x')
    expect(v.mode).toBe('soa')
    expect(colPosX).toBeInstanceOf(Float64Array)
    for (let i = 0; i < 5; i++) {
      expect(colPosX[i]).toBeCloseTo(i * 10.0)
    }
  })
})

// ---------------------------------------------------------------------------
// .graduate() explicit method
// ---------------------------------------------------------------------------

describe('vec graduation — .graduate() method', () => {
  it('graduate() forces graduation even when len is 0', () => {
    const v = vec(Point2D)
    expect(v.mode).toBe('js')
    v.graduate()
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
  })

  it('graduate() forces graduation with a few elements', () => {
    const v = vec(Point2D)
    const h0 = v.push(); h0.x = 1.1; h0.y = 2.2
    const h1 = v.push(); h1.x = 3.3; h1.y = 4.4

    v.graduate()
    expect(v.mode).toBe('soa')

    const r0 = v.get(0)
    expect(r0.x).toBeCloseTo(1.1)
    expect(r0.y).toBeCloseTo(2.2)

    const r1 = v.get(1)
    expect(r1.x).toBeCloseTo(3.3)
    expect(r1.y).toBeCloseTo(4.4)
  })

  it('graduate() is a no-op if already SoA (called twice)', () => {
    const v = vec(Point2D)
    v.graduate()
    expect(v.mode).toBe('soa')
    // Second call should not throw or change state
    v.graduate()
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
  })

  it('graduate() is a no-op on vec started with capacity (already SoA)', () => {
    const v = vec(Point2D, 10)
    expect(v.mode).toBe('soa')
    v.graduate() // no-op
    expect(v.mode).toBe('soa')
  })

  it('graduate() with nested struct data preserves all values', () => {
    const v = vec(Nested)
    for (let i = 0; i < 10; i++) {
      const h = v.push()
      h.pos.x = i * 5.0
      h.pos.y = i * 10.0
      h.pos.z = i * 15.0
      h.id = i * 2
    }

    v.graduate()
    expect(v.mode).toBe('soa')

    for (let i = 0; i < 10; i++) {
      const h = v.get(i)
      expect(h.pos.x).toBeCloseTo(i * 5.0)
      expect(h.pos.y).toBeCloseTo(i * 10.0)
      expect(h.pos.z).toBeCloseTo(i * 15.0)
      expect(h.id).toBe(i * 2)
    }
  })
})

// ---------------------------------------------------------------------------
// Post-graduation operations
// ---------------------------------------------------------------------------

describe('vec graduation — post-graduation operations', () => {
  it('push() works after graduation', () => {
    const v = vec(Point2D)
    v.graduate()

    const h = v.push()
    h.x = 42
    h.y = 99
    expect(v.len).toBe(1)
    expect(h.x).toBeCloseTo(42)
    expect(h.y).toBeCloseTo(99)
  })

  it('get() works after graduation', () => {
    const v = vec(Point2D)
    const h = v.push(); h.x = 7; h.y = 8
    v.graduate()

    const r = v.get(0)
    expect(r.x).toBeCloseTo(7)
    expect(r.y).toBeCloseTo(8)
  })

  it('forEach() works after graduation', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.x = i * 3
      h.y = i * 7
    }
    v.graduate()

    const xs: number[] = []
    const ys: number[] = []
    v.forEach((h) => {
      xs.push(h.x)
      ys.push(h.y)
    })

    expect(xs).toEqual([0, 3, 6, 9, 12])
    expect(ys).toEqual([0, 7, 14, 21, 28])
  })

  it('for..of works after graduation', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 3; i++) {
      const h = v.push()
      h.x = (i + 1) * 10
    }
    v.graduate()

    const xs: number[] = []
    for (const h of v) {
      xs.push(h.x)
    }
    expect(xs).toEqual([10, 20, 30])
  })

  it('swapRemove() works after graduation', () => {
    const v = vec(Point2D)
    const h0 = v.push(); h0.x = 10; h0.y = 100
    const h1 = v.push(); h1.x = 20; h1.y = 200
    const h2 = v.push(); h2.x = 30; h2.y = 300
    v.graduate()

    // Remove index 0: last element (30,300) moves to index 0
    v.swapRemove(0)
    expect(v.len).toBe(2)
    expect(v.get(0).x).toBeCloseTo(30)
    expect(v.get(0).y).toBeCloseTo(300)
  })

  it('remove() works after graduation', () => {
    const v = vec(Point2D)
    const h0 = v.push(); h0.x = 10
    const h1 = v.push(); h1.x = 20
    const h2 = v.push(); h2.x = 30
    v.graduate()

    v.remove(1) // remove x=20
    expect(v.len).toBe(2)
    expect(v.get(0).x).toBeCloseTo(10)
    expect(v.get(1).x).toBeCloseTo(30)
  })

  it('pop() works after graduation', () => {
    const v = vec(Point2D)
    v.push()
    v.push()
    v.push()
    v.graduate()
    expect(v.len).toBe(3)
    v.pop()
    expect(v.len).toBe(2)
  })

  it('column() returns TypedArray after graduation', () => {
    const v = vec(Point2D)
    const h0 = v.push(); h0.x = 11; h0.y = 22
    v.graduate()

    const colX = v.column('x')
    const colY = v.column('y')
    expect(colX).toBeInstanceOf(Float64Array)
    expect(colY).toBeInstanceOf(Float64Array)
    expect(colX[0]).toBeCloseTo(11)
    expect(colY[0]).toBeCloseTo(22)
  })

  it('buffer is accessible after graduation', () => {
    const v = vec(Point2D)
    v.push()
    v.graduate()
    expect(v.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('reserve() works after graduation', () => {
    const v = vec(Point2D)
    v.graduate()
    expect(() => v.reserve(256)).not.toThrow()
    expect(v.capacity).toBeGreaterThanOrEqual(256)
  })

  it('clear() works after graduation', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 5; i++) v.push()
    v.graduate()
    v.clear()
    expect(v.len).toBe(0)
    expect(v.mode).toBe('soa') // still SoA after clear
  })

  it('drop() works after graduation', () => {
    const v = vec(Point2D)
    v.graduate()
    v.drop()
    expect(() => v.push()).toThrow('vec has been dropped')
  })
})

// ---------------------------------------------------------------------------
// vec with capacity skips JS mode entirely
// ---------------------------------------------------------------------------

describe('vec graduation — vec with capacity is always SoA', () => {
  it('vec(def, cap) starts in SoA mode (no graduation needed)', () => {
    const v = vec(Point2D, 10)
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
    expect(v.capacity).toBe(10)
  })

  it('vec(def, cap) buffer is accessible immediately', () => {
    const v = vec(Point2D, 10)
    expect(v.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('vec(def, cap) column() works immediately without graduation', () => {
    const v = vec(Point2D, 10)
    const h = v.push(); h.x = 55
    const col = v.column('x')
    expect(col).toBeInstanceOf(Float64Array)
    expect(col[0]).toBeCloseTo(55)
  })
})

// ---------------------------------------------------------------------------
// Capacity after graduation
// ---------------------------------------------------------------------------

describe('vec graduation — capacity after graduation', () => {
  it('after graduation, capacity >= len * 2', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 128; i++) v.push()
    // Graduated: soaCapacity = max(128 * 2, 128) = 256
    expect(v.capacity).toBeGreaterThanOrEqual(256)
  })

  it('after .graduate() with 10 items, capacity >= 20', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 10; i++) v.push()
    v.graduate()
    expect(v.capacity).toBeGreaterThanOrEqual(20)
  })

  it('after .graduate() with 0 items, capacity >= 128 (minimum)', () => {
    const v = vec(Point2D)
    v.graduate()
    // soaCapacity = max(0 * 2, 128) = 128
    expect(v.capacity).toBeGreaterThanOrEqual(128)
  })
})
