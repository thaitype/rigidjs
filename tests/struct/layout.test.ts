import { describe, it, expect } from 'bun:test'
import { computeLayout, isNumericType } from '../../src/struct/layout.js'
import { NUMERIC_SIZES } from '../../src/types.js'
import type { NumericType, StructFields } from '../../src/types.js'

// ---------------------------------------------------------------------------
// sizeof for each of the 8 numeric types in isolation
// ---------------------------------------------------------------------------
describe('computeLayout — single numeric field sizeof', () => {
  const cases: Array<[NumericType, number]> = [
    ['f64', 8],
    ['f32', 4],
    ['u32', 4],
    ['u16', 2],
    ['u8',  1],
    ['i32', 4],
    ['i16', 2],
    ['i8',  1],
  ]

  for (const [type, expectedBytes] of cases) {
    it(`sizeof({ v: '${type}' }) === ${expectedBytes}`, () => {
      const { sizeof } = computeLayout({ v: type })
      expect(sizeof).toBe(expectedBytes)
    })
  }
})

// ---------------------------------------------------------------------------
// sizeof for Vec3 (3 × f64)
// ---------------------------------------------------------------------------
describe('computeLayout — Vec3', () => {
  it("sizeof({ x: 'f64', y: 'f64', z: 'f64' }) === 24", () => {
    const { sizeof } = computeLayout({ x: 'f64', y: 'f64', z: 'f64' })
    expect(sizeof).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// Mixed-type struct sizeof
// ---------------------------------------------------------------------------
describe('computeLayout — mixed types', () => {
  it("sizeof({ a: 'u8', b: 'u32', c: 'f64' }) === 13", () => {
    // u8=1 + u32=4 + f64=8 = 13 (no padding)
    const { sizeof } = computeLayout({ a: 'u8', b: 'u32', c: 'f64' })
    expect(sizeof).toBe(13)
  })
})

// ---------------------------------------------------------------------------
// Nested struct — Particle from spec §4.1
//
// const Vec3 = { sizeof: 24, fields: { x: 'f64', y: 'f64', z: 'f64' } }
// const Particle = struct({
//   pos:  Vec3,   // 24 bytes at offset 0
//   vel:  Vec3,   // 24 bytes at offset 24
//   life: 'f32',  //  4 bytes at offset 48
//   id:   'u32',  //  4 bytes at offset 52
// })
// sizeof: 56 bytes
// ---------------------------------------------------------------------------
describe('computeLayout — Particle (nested structs)', () => {
  // Minimal StructDef-like object for Vec3 (not the real struct() yet — task 3)
  const Vec3Fields: StructFields = { x: 'f64', y: 'f64', z: 'f64' }
  const Vec3Layout = computeLayout(Vec3Fields)
  const Vec3Def = { sizeof: Vec3Layout.sizeof, fields: Vec3Fields }

  const ParticleFields: StructFields = {
    pos:  Vec3Def,
    vel:  Vec3Def,
    life: 'f32',
    id:   'u32',
  }

  const { sizeof, offsets } = computeLayout(ParticleFields)

  it('Particle sizeof === 56', () => {
    expect(sizeof).toBe(56)
  })

  it('Particle top-level offset pos === 0', () => {
    expect(offsets.get('pos')?.offset).toBe(0)
  })

  it('Particle top-level offset vel === 24', () => {
    expect(offsets.get('vel')?.offset).toBe(24)
  })

  it('Particle top-level offset life === 48', () => {
    expect(offsets.get('life')?.offset).toBe(48)
  })

  it('Particle top-level offset id === 52', () => {
    expect(offsets.get('id')?.offset).toBe(52)
  })
})

// ---------------------------------------------------------------------------
// Empty fields throws
// ---------------------------------------------------------------------------
describe('computeLayout — empty fields', () => {
  it('throws an Error for empty field map', () => {
    expect(() => computeLayout({})).toThrow(Error)
  })

  it('error message is descriptive', () => {
    expect(() => computeLayout({})).toThrow('computeLayout: fields must not be empty')
  })
})

// ---------------------------------------------------------------------------
// isNumericType guard
// ---------------------------------------------------------------------------
describe('isNumericType', () => {
  it('returns true for all 8 numeric type tokens', () => {
    const types = Object.keys(NUMERIC_SIZES) as NumericType[]
    for (const t of types) {
      expect(isNumericType(t)).toBe(true)
    }
  })

  it('returns false for a StructDef-like object', () => {
    const fakeStructDef = { sizeof: 24, fields: {} }
    expect(isNumericType(fakeStructDef)).toBe(false)
  })
})
