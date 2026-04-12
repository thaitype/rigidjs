/**
 * Compile-time type assertion tests for ColumnKey<F> and ColumnType<F, K>.
 *
 * The runtime content of these tests is trivial — the assertions are in the
 * TypeScript type annotations themselves. If this file compiles without error,
 * the type helpers satisfy the worked examples in
 * `.chief/milestone-3/_contract/public-api.md`.
 */
import { describe, it, expect } from 'bun:test'
import type { ColumnKey, ColumnType, StructFields } from '../../src/types.js'
import type { StructDef } from '../../src/types.js'
import { struct } from '../../src/struct/struct.js'

// ---------------------------------------------------------------------------
// Define test structs (type-level)
// These use the same shapes as the worked examples in the contract.
// ---------------------------------------------------------------------------

type V3Fields = { x: 'f64'; y: 'f64'; z: 'f64' }
type ParticleFields = {
  pos: StructDef<V3Fields>
  vel: StructDef<V3Fields>
  life: 'f32'
  id: 'u32'
}

// ---------------------------------------------------------------------------
// ColumnKey<P> must be the union of all dotted leaf keys
// ---------------------------------------------------------------------------

describe('ColumnKey<F> compile-time assertions', () => {
  it('ColumnKey<ParticleFields> accepts valid column names (no TS error)', () => {
    // These assignments would fail to compile if ColumnKey<ParticleFields>
    // does not include these strings in its union.
    const a: ColumnKey<ParticleFields> = 'pos.x'
    const b: ColumnKey<ParticleFields> = 'pos.y'
    const c: ColumnKey<ParticleFields> = 'pos.z'
    const d: ColumnKey<ParticleFields> = 'vel.x'
    const e: ColumnKey<ParticleFields> = 'vel.y'
    const f: ColumnKey<ParticleFields> = 'vel.z'
    const g: ColumnKey<ParticleFields> = 'life'
    const h: ColumnKey<ParticleFields> = 'id'
    // Silence unused-variable lints.
    expect([a, b, c, d, e, f, g, h].length).toBe(8)
  })

  it('ColumnKey<V3Fields> accepts x, y, z (no TS error)', () => {
    const a: ColumnKey<V3Fields> = 'x'
    const b: ColumnKey<V3Fields> = 'y'
    const c: ColumnKey<V3Fields> = 'z'
    expect([a, b, c].length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// ColumnType<F, K> must resolve to the correct TypedArray subclass
// ---------------------------------------------------------------------------

describe('ColumnType<F, K> compile-time assertions', () => {
  it('ColumnType<ParticleFields, "pos.x"> is Float64Array', () => {
    // This assignment is a compile-time assertion — if the type resolves
    // incorrectly it would fail to compile.
    const xs: ColumnType<ParticleFields, 'pos.x'> = new Float64Array(1)
    expect(xs instanceof Float64Array).toBe(true)
  })

  it('ColumnType<ParticleFields, "vel.z"> is Float64Array', () => {
    const zs: ColumnType<ParticleFields, 'vel.z'> = new Float64Array(1)
    expect(zs instanceof Float64Array).toBe(true)
  })

  it('ColumnType<ParticleFields, "life"> is Float32Array', () => {
    const lives: ColumnType<ParticleFields, 'life'> = new Float32Array(1)
    expect(lives instanceof Float32Array).toBe(true)
  })

  it('ColumnType<ParticleFields, "id"> is Uint32Array', () => {
    const ids: ColumnType<ParticleFields, 'id'> = new Uint32Array(1)
    expect(ids instanceof Uint32Array).toBe(true)
  })

  it('ColumnType<V3Fields, "x"> is Float64Array', () => {
    const xs: ColumnType<V3Fields, 'x'> = new Float64Array(1)
    expect(xs instanceof Float64Array).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Negative compile-time checks (using @ts-expect-error)
// ---------------------------------------------------------------------------

describe('ColumnKey<F> rejects invalid names at compile time', () => {
  it('invalid column name causes TS error (verified by @ts-expect-error)', () => {
    // @ts-expect-error — 'nope' is not a valid ColumnKey<ParticleFields>
    const _bad: ColumnKey<ParticleFields> = 'nope'
    void _bad
    expect(true).toBe(true)  // runtime tautology; the assertion is the type annotation
  })

  it('top-level nested field name alone is not a valid ColumnKey (must use dotted form)', () => {
    // @ts-expect-error — 'pos' is not a valid ColumnKey<ParticleFields> (must be 'pos.x' etc.)
    const _bad: ColumnKey<ParticleFields> = 'pos'
    void _bad
    expect(true).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Verify with runtime struct() instances (structural check)
// ---------------------------------------------------------------------------

describe('ColumnKey / ColumnType with struct() instances', () => {
  const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
  type Vec3SF = typeof Vec3['fields']

  it('ColumnKey<Vec3SF> type-checks x, y, z at runtime', () => {
    const keys: Array<ColumnKey<Vec3SF>> = ['x', 'y', 'z']
    expect(keys.length).toBe(3)
  })

  it('ColumnType<Vec3SF, "x"> = Float64Array instance compiles', () => {
    const arr: ColumnType<Vec3SF, 'x'> = new Float64Array(4)
    expect(arr.BYTES_PER_ELEMENT).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// Verify all 8 numeric type → TypedArray mappings
// ---------------------------------------------------------------------------

describe('ColumnType numeric type → TypedArray mapping coverage', () => {
  type AllFields = {
    a: 'f64'
    b: 'f32'
    c: 'u32'
    d: 'u16'
    e: 'u8'
    f: 'i32'
    g: 'i16'
    h: 'i8'
  }

  it('f64 → Float64Array', () => {
    const v: ColumnType<AllFields, 'a'> = new Float64Array(1)
    expect(v.BYTES_PER_ELEMENT).toBe(8)
  })

  it('f32 → Float32Array', () => {
    const v: ColumnType<AllFields, 'b'> = new Float32Array(1)
    expect(v.BYTES_PER_ELEMENT).toBe(4)
  })

  it('u32 → Uint32Array', () => {
    const v: ColumnType<AllFields, 'c'> = new Uint32Array(1)
    expect(v.BYTES_PER_ELEMENT).toBe(4)
  })

  it('u16 → Uint16Array', () => {
    const v: ColumnType<AllFields, 'd'> = new Uint16Array(1)
    expect(v.BYTES_PER_ELEMENT).toBe(2)
  })

  it('u8 → Uint8Array', () => {
    const v: ColumnType<AllFields, 'e'> = new Uint8Array(1)
    expect(v.BYTES_PER_ELEMENT).toBe(1)
  })

  it('i32 → Int32Array', () => {
    const v: ColumnType<AllFields, 'f'> = new Int32Array(1)
    expect(v.BYTES_PER_ELEMENT).toBe(4)
  })

  it('i16 → Int16Array', () => {
    const v: ColumnType<AllFields, 'g'> = new Int16Array(1)
    expect(v.BYTES_PER_ELEMENT).toBe(2)
  })

  it('i8 → Int8Array', () => {
    const v: ColumnType<AllFields, 'h'> = new Int8Array(1)
    expect(v.BYTES_PER_ELEMENT).toBe(1)
  })
})
