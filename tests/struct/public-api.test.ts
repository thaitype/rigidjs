/**
 * Public API acceptance tests for milestone-1.
 * All imports come exclusively from the package entry (src/index.ts).
 * This verifies the public surface — no internal helpers are used here.
 */
import { describe, it, expect } from 'bun:test'
import { struct, slab } from '../../src/index.js'
import type { StructDef, StructFields, NumericType } from '../../src/index.js'

// ---------------------------------------------------------------------------
// struct({ x, y, z }) sizeof === 24
// ---------------------------------------------------------------------------
describe('public API — Vec3 sizeof', () => {
  it('struct({ x: f64, y: f64, z: f64 }).sizeof === 24', () => {
    const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
    expect(Vec3.sizeof).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// Particle example sizeof === 56 with correct per-field offsets
// ---------------------------------------------------------------------------
describe('public API — Particle sizeof and field offsets', () => {
  const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
  const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })

  it('Particle.sizeof === 56', () => {
    // pos(24) + vel(24) + life(4) + id(4) = 56
    expect(Particle.sizeof).toBe(56)
  })

  it('Particle._offsets has correct byte offsets (AoS offsets preserved for compatibility)', () => {
    // _offsets is preserved from the AoS layout computation for test compatibility.
    // These are per-slot byte offsets in declaration order (NOT physical SoA buffer offsets).
    const offsets = Particle._offsets!
    expect(offsets.get('pos')!.offset).toBe(0)
    expect(offsets.get('vel')!.offset).toBe(24)
    expect(offsets.get('life')!.offset).toBe(48)
    expect(offsets.get('id')!.offset).toBe(52)
  })
})

// ---------------------------------------------------------------------------
// struct({}) throws a clear Error
// ---------------------------------------------------------------------------
describe('public API — empty fields guard', () => {
  it('struct({}) throws an Error', () => {
    expect(() => struct({})).toThrow(Error)
  })

  it('struct({}) error message mentions empty fields', () => {
    expect(() => struct({})).toThrow('fields must not be empty')
  })
})

// ---------------------------------------------------------------------------
// Handle field access is typed as number (type-level check via satisfies)
// Updated for milestone-3 SoA: _Handle is no longer on StructDef.
// Use slab(def, 1) to get a handle and verify field access is typed.
// ---------------------------------------------------------------------------
describe('public API — handle field access typed as number', () => {
  it('reading a f64 field satisfies the number type', () => {
    const Vec3 = struct({ v: 'f64' })
    const s = slab(Vec3, 1)
    const handle = s.insert() as { v: number }

    handle.v = 42.5
    // Type-level check: the expression `handle.v` satisfies number
    const readBack = handle.v satisfies number
    expect(readBack).toBe(42.5)
  })
})

// ---------------------------------------------------------------------------
// Type imports — StructDef, StructFields, NumericType are importable as types
// ---------------------------------------------------------------------------
describe('public API — type exports are importable', () => {
  it('NumericType is usable as a type annotation', () => {
    const t: NumericType = 'f64'
    expect(t).toBe('f64')
  })

  it('StructFields is usable as a type annotation', () => {
    const fields: StructFields = { x: 'f64', y: 'f32' }
    expect(Object.keys(fields)).toHaveLength(2)
  })

  it('StructDef is usable as a type annotation', () => {
    const def: StructDef<{ x: NumericType }> = struct({ x: 'f64' })
    expect(def.sizeof).toBe(8)
  })
})
