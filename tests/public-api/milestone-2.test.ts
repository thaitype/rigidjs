/**
 * tests/public-api/milestone-2.test.ts
 *
 * Public-surface canary for milestone-2.
 * Imports ONLY from src/index.js to verify the exported symbols are correct.
 *
 * Mirrors tests/struct/public-api.test.ts from milestone-1.
 *
 * Note: Handle<F> resolves to `object` at the TypeScript level because the
 * handle class is code-generated at runtime via new Function(). Field access
 * uses `as unknown as Record<string, number>` casts where needed, matching
 * the pattern used throughout the slab test suite.
 *
 * Task-5 amendment: remove() and has() now take a numeric slot, not a handle.
 * This file verifies the new signatures compile and pass.
 */

import { describe, it, expect } from 'bun:test'
import { struct, slab, type Slab, type Handle, type StructDef } from '../../src/index.js'

// ---------------------------------------------------------------------------
// typeof checks
// ---------------------------------------------------------------------------

describe('public-api — slab export', () => {
  it('typeof slab === "function"', () => {
    expect(typeof slab).toBe('function')
  })

  it('slab(struct({ x: "f64" }), 4).capacity === 4', () => {
    const s = slab(struct({ x: 'f64' }), 4)
    expect(s.capacity).toBe(4)
    s.drop()
  })
})

// ---------------------------------------------------------------------------
// Type annotation checks (compile-only — if this file typechecks, it passes)
// ---------------------------------------------------------------------------

describe('public-api — Slab and Handle type annotations', () => {
  it('Slab<F> is usable as a variable annotation', () => {
    const s: Slab<{ x: 'f64' }> = slab(struct({ x: 'f64' }), 4)
    expect(s.capacity).toBe(4)
    s.drop()
  })

  it('Handle<F> is usable as a variable annotation (field access via cast)', () => {
    const def = struct({ x: 'f64' })
    const s = slab(def, 4)
    // Handle<F> resolves to `object` — cast to access codegen'd fields.
    const h: Handle<typeof def.fields> = s.insert()
    const hAny = h as unknown as Record<string, number>
    hAny['x'] = 3.14
    expect(hAny['x']).toBeCloseTo(3.14)
    s.drop()
  })

  it('StructDef is usable as a type annotation', () => {
    const def: StructDef<{ x: 'f64' }> = struct({ x: 'f64' })
    expect(def.sizeof).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// Insert-then-get reference equality (handle reuse contract)
// ---------------------------------------------------------------------------

describe('public-api — handle reuse', () => {
  it('insert() returns the same handle instance as get()', () => {
    const s = slab(struct({ x: 'f64' }), 4)
    const h = s.insert()
    // get() rebases the same shared handle instance
    expect(s.get(0)).toBe(h)
    s.drop()
  })

  it('two sequential inserts return the same object reference', () => {
    const s = slab(struct({ x: 'f64' }), 4)
    const a = s.insert()
    ;(a as unknown as Record<string, number>)['x'] = 1
    const b = s.insert()
    ;(b as unknown as Record<string, number>)['x'] = 2
    // a and b are the same object — they point to the latest slot
    expect(a).toBe(b)
    // slot 0 still holds the value written via a
    expect((s.get(0) as unknown as Record<string, number>)['x']).toBe(1)
    s.drop()
  })
})

// ---------------------------------------------------------------------------
// Task-5 amendment: remove(slot) and has(slot) take numbers
// ---------------------------------------------------------------------------

describe('public-api — remove and has take numeric slot (task-5)', () => {
  it('remove(slot) accepts a number and frees the slot', () => {
    const s = slab(struct({ x: 'f64' }), 4)
    s.insert()
    // Compiles only if remove() accepts number — type check passes here
    s.remove(0)
    expect(s.len).toBe(0)
    s.drop()
  })

  it('has(slot) accepts a number and returns boolean', () => {
    const s = slab(struct({ x: 'f64' }), 4)
    s.insert()
    expect(s.has(0)).toBe(true)
    s.remove(0)
    expect(s.has(0)).toBe(false)
    s.drop()
  })

  it('handle.slot is a number — slot capture pattern compiles', () => {
    const s = slab(struct({ x: 'f64' }), 4)
    // Capture slot index as a number immediately after insert()
    const slotA: number = (s.insert() as any).slot
    const slotB: number = (s.insert() as any).slot
    expect(slotA).toBe(0)
    expect(slotB).toBe(1)
    // Use the captured primitive to remove — immune to handle rebasing
    s.remove(slotA)
    expect(s.has(0)).toBe(false)
    expect(s.has(1)).toBe(true)
    s.drop()
  })
})

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('public-api — error cases', () => {
  it('slab(struct({ x: "f64" }), 0) throws', () => {
    expect(() => slab(struct({ x: 'f64' }), 0)).toThrow()
  })

  it('use-after-drop throws', () => {
    const s = slab(struct({ x: 'f64' }), 4)
    s.drop()
    expect(() => s.insert()).toThrow('slab has been dropped')
    expect(() => s.len).toThrow('slab has been dropped')
    expect(() => s.capacity).toThrow('slab has been dropped')
  })
})
