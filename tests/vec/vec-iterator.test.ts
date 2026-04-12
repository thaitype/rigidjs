import { describe, it, expect } from 'bun:test'
import { struct, vec } from '../../src/index.js'

// ---------------------------------------------------------------------------
// Test structs
// ---------------------------------------------------------------------------

const Point2D = struct({ x: 'f64', y: 'f64' })
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Nested = struct({ pos: Vec3, id: 'u32' })

// ---------------------------------------------------------------------------
// Basic iteration order and values
// ---------------------------------------------------------------------------

describe('vec Symbol.iterator', () => {
  it('iterates all elements in order (0 to len-1)', () => {
    const v = vec(Point2D, 8)
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.x = i * 10
      h.y = i * -5
    }

    const slots: number[] = []
    const xs: number[] = []
    const ys: number[] = []

    for (const h of v) {
      slots.push(h.slot)
      xs.push(h.x)
      ys.push(h.y)
    }

    expect(slots).toEqual([0, 1, 2, 3, 4])
    expect(xs).toEqual([0, 10, 20, 30, 40])
    // Use Object.is to handle -0 vs 0 — i=0 produces y = 0 * -5 = -0 in IEEE 754.
    // Instead compare absolute values for the zero case.
    expect(ys[0]).toBe(-0)
    expect(ys.slice(1)).toEqual([-5, -10, -15, -20])
  })

  it('values read during iteration match what was pushed', () => {
    const v = vec(Point2D, 4)
    const expected = [
      { x: 1.5, y: 2.5 },
      { x: 3.5, y: 4.5 },
      { x: 5.5, y: 6.5 },
    ]
    for (const pt of expected) {
      const h = v.push()
      h.x = pt.x
      h.y = pt.y
    }

    let i = 0
    for (const h of v) {
      expect(h.x).toBe(expected[i]!.x)
      expect(h.y).toBe(expected[i]!.y)
      i++
    }
    expect(i).toBe(3)
  })

  it('yields the same handle instance at every step (handle reuse)', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    v.push()

    // Use the manual iterator protocol to capture references across next() calls.
    const iter = v[Symbol.iterator]()
    const r0 = iter.next()
    const r1 = iter.next()
    const r2 = iter.next()
    const r3 = iter.next()

    expect(r3.done).toBe(true)
    // All yielded values should be the exact same object reference.
    expect(r0.value).toBe(r1.value)
    expect(r1.value).toBe(r2.value)
  })

  it('handle.slot equals the expected index inside the loop', () => {
    const v = vec(Point2D, 6)
    for (let i = 0; i < 6; i++) v.push()

    let expectedSlot = 0
    for (const h of v) {
      expect(h.slot).toBe(expectedSlot)
      expectedSlot++
    }
  })

  it('for..of on empty vec: loop body never executes', () => {
    const v = vec(Point2D, 4)
    let count = 0
    for (const _ of v) {
      count++
    }
    expect(count).toBe(0)
  })

  it('for..of after push+pop iterates only over live elements', () => {
    const v = vec(Point2D, 8)
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.x = i
      h.y = i
    }
    v.pop() // len is now 4
    v.pop() // len is now 3

    const slots: number[] = []
    for (const h of v) {
      slots.push(h.slot)
    }
    expect(slots).toEqual([0, 1, 2])
    expect(v.len).toBe(3)
  })

  it('for..of after drop throws "vec has been dropped" on first next()', () => {
    const v = vec(Point2D, 4)
    v.push()
    v.push()
    v.drop()

    const iter = v[Symbol.iterator]()
    expect(() => iter.next()).toThrow('vec has been dropped')
  })

  it('spread [...vec] produces an array where every element is the same reference', () => {
    const v = vec(Point2D, 4)
    for (let i = 0; i < 3; i++) {
      const h = v.push()
      h.x = i
      h.y = i * 2
    }

    const arr = [...v]
    // All elements in the spread array are the same handle reference (handle reuse).
    // The handle is rebased to len-1 after the iteration ends.
    expect(arr.length).toBe(3)
    expect(arr[0]).toBe(arr[1])
    expect(arr[1]).toBe(arr[2])
    // After spread, the handle is at slot 2 (last rebased position).
    expect(arr[0]!.slot).toBe(2)
  })

  it('nested struct access works inside for..of', () => {
    const v = vec(Nested, 4)
    for (let i = 0; i < 3; i++) {
      const h = v.push()
      h.pos.x = i * 1.0
      h.pos.y = i * 2.0
      h.pos.z = i * 3.0
      h.id = i + 100
    }

    const results: { x: number; y: number; z: number; id: number }[] = []
    for (const h of v) {
      results.push({ x: h.pos.x, y: h.pos.y, z: h.pos.z, id: h.id })
    }

    expect(results).toEqual([
      { x: 0, y: 0, z: 0, id: 100 },
      { x: 1, y: 2, z: 3, id: 101 },
      { x: 2, y: 4, z: 6, id: 102 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Integration test — import from public API entry point
// ---------------------------------------------------------------------------

describe('vec public API integration (import from src/index.js)', () => {
  it('full round-trip: struct + vec + push + iterate + drop via public API', () => {
    // This test imports struct and vec from the public entry point,
    // confirming the re-export wiring in src/index.ts is correct.
    const Color = struct({ r: 'u8', g: 'u8', b: 'u8' })
    const v = vec(Color, 4)

    // push
    const h0 = v.push(); h0.r = 255; h0.g = 0; h0.b = 0
    const h1 = v.push(); h1.r = 0;   h1.g = 255; h1.b = 0
    const h2 = v.push(); h2.r = 0;   h2.g = 0;   h2.b = 255

    expect(v.len).toBe(3)

    // iterate
    const rgbs: [number, number, number][] = []
    for (const h of v) {
      rgbs.push([h.r, h.g, h.b])
    }
    // Note: all entries in rgbs are the same handle reference,
    // so only the last rebased values are reflected.
    // Capture primitives to get each iteration's values — done above via push().
    // Here we verify via get() instead.
    const got = [0, 1, 2].map(i => {
      const h = v.get(i)
      return [h.r, h.g, h.b] as [number, number, number]
    })
    expect(got).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]])

    // drop
    v.drop()
    expect(() => v.push()).toThrow('vec has been dropped')
  })
})
