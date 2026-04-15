/**
 * Tests for vec Options API — milestone-7 task-4.
 *
 * Covers all VecOptions combinations:
 *   - vec(T)                              → hybrid mode (JS, graduates at 128)
 *   - vec(T, number)                      → backward compat, SoA mode
 *   - vec(T, { capacity: N })             → SoA mode, capacity=N
 *   - vec(T, { mode: 'soa' })             → SoA mode, default capacity (16)
 *   - vec(T, { mode: 'js' })              → permanent JS mode, never graduates
 *   - vec(T, { graduateAt: N })           → hybrid mode, custom threshold
 *   - vec(T, { mode: 'soa', capacity: N })→ SoA mode, capacity=N
 *   - vec(T, { mode: 'js', graduateAt: N })→ JS permanent (graduateAt ignored)
 *   - vec(T, { mode: 'js', capacity: N }) → throws (contradictory)
 *   - vec(T, { capacity: 0 })             → throws (must be positive integer)
 *   - vec(T, { capacity: -1 })            → throws (must be positive integer)
 *   - vec(T, { graduateAt: 0 })           → throws (must be positive integer)
 *   - vec(T, { graduateAt: -5 })          → throws (must be positive integer)
 */

import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { vec } from '../../src/vec/vec.js'

// ---------------------------------------------------------------------------
// Test structs
// ---------------------------------------------------------------------------

const Point2D = struct({ x: 'f64', y: 'f64' })

// ---------------------------------------------------------------------------
// vec(T) — default hybrid mode
// ---------------------------------------------------------------------------

describe('vec options — default hybrid mode vec(T)', () => {
  it('starts in JS mode', () => {
    const v = vec(Point2D)
    expect(v.mode).toBe('js')
    expect(v.isGraduated).toBe(false)
  })

  it('auto-graduates at len=128 (default threshold)', () => {
    const v = vec(Point2D)
    for (let i = 0; i < 127; i++) v.push()
    expect(v.mode).toBe('js')

    v.push() // 128th push triggers graduation
    expect(v.mode).toBe('soa')
    expect(v.len).toBe(128)
  })
})

// ---------------------------------------------------------------------------
// vec(T, number) — backward compat
// ---------------------------------------------------------------------------

describe('vec options — backward compat vec(T, number)', () => {
  it('vec(T, 16) starts in SoA mode with capacity 16', () => {
    const v = vec(Point2D, 16)
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
    expect(v.capacity).toBe(16)
  })

  it('vec(T, 1000) starts in SoA mode with capacity 1000', () => {
    const v = vec(Point2D, 1000)
    expect(v.mode).toBe('soa')
    expect(v.capacity).toBe(1000)
    expect(v.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('vec(T, number) never requires graduation (already SoA)', () => {
    const v = vec(Point2D, 10)
    expect(v.isGraduated).toBe(true)
    for (let i = 0; i < 9; i++) v.push()
    expect(v.mode).toBe('soa')
  })
})

// ---------------------------------------------------------------------------
// vec(T, { capacity: N }) — SoA mode with explicit capacity
// ---------------------------------------------------------------------------

describe('vec options — { capacity: N }', () => {
  it('starts in SoA mode with the given capacity', () => {
    const v = vec(Point2D, { capacity: 500 })
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
    expect(v.capacity).toBe(500)
  })

  it('buffer is immediately accessible', () => {
    const v = vec(Point2D, { capacity: 100 })
    expect(v.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('push and get work correctly in SoA mode', () => {
    const v = vec(Point2D, { capacity: 100 })
    const h = v.push()
    h.x = 42
    h.y = 7
    expect(v.get(0).x).toBeCloseTo(42)
    expect(v.get(0).y).toBeCloseTo(7)
  })
})

// ---------------------------------------------------------------------------
// vec(T, { mode: 'soa' }) — SoA mode with default capacity
// ---------------------------------------------------------------------------

describe('vec options — { mode: "soa" }', () => {
  it('starts in SoA mode', () => {
    const v = vec(Point2D, { mode: 'soa' })
    expect(v.mode).toBe('soa')
    expect(v.isGraduated).toBe(true)
  })

  it('has default capacity of 16 when no explicit capacity given', () => {
    const v = vec(Point2D, { mode: 'soa' })
    expect(v.capacity).toBe(16)
  })

  it('buffer is immediately accessible', () => {
    const v = vec(Point2D, { mode: 'soa' })
    expect(v.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('push/get work in SoA mode', () => {
    const v = vec(Point2D, { mode: 'soa' })
    const h = v.push()
    h.x = 3.14
    h.y = 2.71
    expect(v.get(0).x).toBeCloseTo(3.14)
    expect(v.get(0).y).toBeCloseTo(2.71)
  })
})

// ---------------------------------------------------------------------------
// vec(T, { mode: 'soa', capacity: N }) — SoA mode with explicit capacity
// ---------------------------------------------------------------------------

describe('vec options — { mode: "soa", capacity: N }', () => {
  it('starts in SoA mode with given capacity', () => {
    const v = vec(Point2D, { mode: 'soa', capacity: 100 })
    expect(v.mode).toBe('soa')
    expect(v.capacity).toBe(100)
  })

  it('buffer is accessible and correct size', () => {
    const v = vec(Point2D, { mode: 'soa', capacity: 50 })
    expect(v.buffer).toBeInstanceOf(ArrayBuffer)
    // Point2D: 2 f64 fields = 16 bytes per slot; 50 slots = 800 bytes
    expect(v.buffer.byteLength).toBe(16 * 50)
  })
})

// ---------------------------------------------------------------------------
// vec(T, { mode: 'js' }) — permanent JS mode
// ---------------------------------------------------------------------------

describe('vec options — { mode: "js" }', () => {
  it('starts in JS mode', () => {
    const v = vec(Point2D, { mode: 'js' })
    expect(v.mode).toBe('js')
    expect(v.isGraduated).toBe(false)
  })

  it('never auto-graduates even when pushed past default threshold (128)', () => {
    const v = vec(Point2D, { mode: 'js' })
    for (let i = 0; i < 200; i++) {
      v.push()
    }
    // Still in JS mode — never graduated
    expect(v.mode).toBe('js')
    expect(v.isGraduated).toBe(false)
    expect(v.len).toBe(200)
  })

  it('never auto-graduates even far past threshold', () => {
    const v = vec(Point2D, { mode: 'js' })
    for (let i = 0; i < 1000; i++) v.push()
    expect(v.mode).toBe('js')
  })

  it('push/get/forEach all work in permanent JS mode', () => {
    const v = vec(Point2D, { mode: 'js' })
    for (let i = 0; i < 5; i++) {
      const h = v.push()
      h.x = i * 10
      h.y = i * -5
    }
    for (let i = 0; i < 5; i++) {
      expect(v.get(i).x).toBeCloseTo(i * 10)
      expect(v.get(i).y).toBeCloseTo(i * -5)
    }
  })

  it('explicit .graduate() still works (overrides permanent-js)', () => {
    // .graduate() is an explicit user request; we honor it even in permanent-js mode
    // because graduateToSoA() is called directly from .graduate() without checking _graduateAt.
    const v = vec(Point2D, { mode: 'js' })
    const h = v.push(); h.x = 99; h.y = 88
    v.graduate()
    expect(v.mode).toBe('soa')
    expect(v.get(0).x).toBeCloseTo(99)
    expect(v.get(0).y).toBeCloseTo(88)
  })
})

// ---------------------------------------------------------------------------
// vec(T, { mode: 'js', graduateAt: N }) — graduateAt ignored in permanent-js mode
// ---------------------------------------------------------------------------

describe('vec options — { mode: "js", graduateAt: N }', () => {
  it('stays in JS mode permanently even with custom graduateAt', () => {
    const v = vec(Point2D, { mode: 'js', graduateAt: 4 })
    // Push well past 4 — should still be JS mode
    for (let i = 0; i < 10; i++) v.push()
    expect(v.mode).toBe('js')
  })
})

// ---------------------------------------------------------------------------
// vec(T, { graduateAt: N }) — custom graduation threshold
// ---------------------------------------------------------------------------

describe('vec options — { graduateAt: N }', () => {
  it('graduates at custom threshold (4)', () => {
    const v = vec(Point2D, { graduateAt: 4 })
    expect(v.mode).toBe('js')

    for (let i = 0; i < 3; i++) v.push()
    expect(v.mode).toBe('js')

    v.push() // 4th push → graduate
    expect(v.mode).toBe('soa')
    expect(v.len).toBe(4)
  })

  it('graduates at custom threshold (10)', () => {
    const v = vec(Point2D, { graduateAt: 10 })
    for (let i = 0; i < 9; i++) v.push()
    expect(v.mode).toBe('js')

    v.push() // 10th push → graduate
    expect(v.mode).toBe('soa')
    expect(v.len).toBe(10)
  })

  it('data is preserved after custom threshold graduation', () => {
    const v = vec(Point2D, { graduateAt: 4 })
    for (let i = 0; i < 4; i++) {
      const h = v.push()
      h.x = i * 3.0
      h.y = i * 7.0
    }
    expect(v.mode).toBe('soa')
    for (let i = 0; i < 4; i++) {
      expect(v.get(i).x).toBeCloseTo(i * 3.0)
      expect(v.get(i).y).toBeCloseTo(i * 7.0)
    }
  })

  it('still starts in JS mode below the custom threshold', () => {
    const v = vec(Point2D, { graduateAt: 256 })
    for (let i = 0; i < 200; i++) v.push()
    expect(v.mode).toBe('js')
  })

  it('graduates at 256 when graduateAt: 256', () => {
    const v = vec(Point2D, { graduateAt: 256 })
    for (let i = 0; i < 255; i++) v.push()
    expect(v.mode).toBe('js')
    v.push() // 256th push → graduate
    expect(v.mode).toBe('soa')
  })
})

// ---------------------------------------------------------------------------
// Validation: invalid option combinations
// ---------------------------------------------------------------------------

describe('vec options — validation errors', () => {
  it('{ mode: "js", capacity: N } throws with descriptive error', () => {
    expect(() => vec(Point2D, { mode: 'js', capacity: 100 })).toThrow(
      'vec: cannot combine mode "js" with capacity (capacity implies SoA mode)'
    )
  })

  it('{ capacity: 0 } throws (must be positive integer)', () => {
    expect(() => vec(Point2D, { capacity: 0 })).toThrow()
  })

  it('{ capacity: -1 } throws (must be positive integer)', () => {
    expect(() => vec(Point2D, { capacity: -1 })).toThrow()
  })

  it('{ capacity: 1.5 } throws (must be an integer)', () => {
    expect(() => vec(Point2D, { capacity: 1.5 })).toThrow()
  })

  it('{ graduateAt: 0 } throws (must be positive integer)', () => {
    expect(() => vec(Point2D, { graduateAt: 0 })).toThrow(
      'vec: graduateAt must be a positive integer'
    )
  })

  it('{ graduateAt: -5 } throws (must be positive integer)', () => {
    expect(() => vec(Point2D, { graduateAt: -5 })).toThrow(
      'vec: graduateAt must be a positive integer'
    )
  })

  it('{ graduateAt: 3.7 } throws (must be an integer)', () => {
    expect(() => vec(Point2D, { graduateAt: 3.7 })).toThrow(
      'vec: graduateAt must be a positive integer'
    )
  })
})

// ---------------------------------------------------------------------------
// VecOptions type exported from src/index.ts
// ---------------------------------------------------------------------------

describe('vec options — VecOptions type export', () => {
  it('VecOptions is usable as a TypeScript type from src/index.ts', () => {
    // This is a compile-time check — if VecOptions is not exported from index.ts,
    // the import would fail at compile time. The test is a runtime no-op.
    // The actual import test is done in vec-options-export.test.ts below.
    // Here we just verify that passing a typed VecOptions object works at runtime.
    const opts: import('../../src/index.js').VecOptions = { graduateAt: 64 }
    const v = vec(Point2D, opts)
    for (let i = 0; i < 63; i++) v.push()
    expect(v.mode).toBe('js')
    v.push()
    expect(v.mode).toBe('soa')
  })
})
