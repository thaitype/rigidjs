import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { createSingleSlot } from '../../src/internal/single-slot.js'
import type { NumericType } from '../../src/types.js'

// ---------------------------------------------------------------------------
// Round-trip write/read for each of the 8 numeric types in isolation
// ---------------------------------------------------------------------------
describe('handle round-trip — each numeric type in isolation', () => {
  const cases: Array<[NumericType, number]> = [
    ['f64', 1.23456789012345],
    ['f32', 3.14],
    ['u32', 0xdeadbeef >>> 0],
    ['u16', 0xabcd],
    ['u8',  0xff],
    ['i32', -2147483648],
    ['i16', -32768],
    ['i8',  -128],
  ]

  for (const [type, value] of cases) {
    it(`round-trip for '${type}': write ${value}, read back`, () => {
      const Def = struct({ v: type })
      const { handle } = createSingleSlot(Def)

      // TypeScript knows handle.v is a number — no `as any` needed here.
      // The generated accessor types flow through the StructDef generic.
      // We use bracket notation because the field name is dynamic in the loop,
      // and cast handle to record for indexing; the round-trip value is compared as number.
      const h = handle as Record<string, number>
      h['v'] = value

      const readBack: number = h['v']!

      // f32 loses precision — compare within float32 tolerance
      if (type === 'f32') {
        const buf = new ArrayBuffer(4)
        const dv = new DataView(buf)
        dv.setFloat32(0, value, true)
        const expected = dv.getFloat32(0, true)
        expect(readBack).toBeCloseTo(expected, 5)
      } else {
        expect(readBack).toBe(value)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Mixed-type flat struct round-trip
// ---------------------------------------------------------------------------
describe('handle round-trip — mixed-type flat struct', () => {
  it('writes and reads back { a: u8, b: u32, c: f64 } correctly', () => {
    const Def = struct({ a: 'u8', b: 'u32', c: 'f64' })
    expect(Def.sizeof).toBe(13) // 1 + 4 + 8 = 13, no padding

    const { handle } = createSingleSlot(Def)

    // Access via typed handle (number fields — no `as any` in assertions)
    const h = handle as { a: number; b: number; c: number }
    h.a = 255
    h.b = 0x12345678
    h.c = Math.PI

    expect(h.a).toBe(255)
    expect(h.b).toBe(0x12345678)
    expect(h.c).toBe(Math.PI)
  })
})

// ---------------------------------------------------------------------------
// Raw DataView byte verification — little-endian proof
// ---------------------------------------------------------------------------
describe('handle — little-endian byte layout verification', () => {
  it('u32 value 0x12345678 at offset 0 stores 0x78 in byte 0 (little-endian)', () => {
    const Def = struct({ val: 'u32' })
    const { handle, view } = createSingleSlot(Def)

    const h = handle as { val: number }
    h.val = 0x12345678

    // Little-endian: least-significant byte first.
    // 0x12345678 → bytes [0x78, 0x56, 0x34, 0x12] at offsets [0, 1, 2, 3]
    expect(view.getUint8(0)).toBe(0x78)
    expect(view.getUint8(1)).toBe(0x56)
    expect(view.getUint8(2)).toBe(0x34)
    expect(view.getUint8(3)).toBe(0x12)
  })

  it('f64 value at offset 4 stores bytes at correct positions with offset applied', () => {
    // struct { pad: u32, val: f64 } — val starts at byte 4
    const Def = struct({ pad: 'u32', val: 'f64' })
    expect(Def.sizeof).toBe(12) // 4 + 8

    const { handle, view } = createSingleSlot(Def)
    const h = handle as { pad: number; val: number }

    h.pad = 0
    h.val = 1.0

    // Read back the f64 directly from the DataView at offset 4 to verify placement
    expect(view.getFloat64(4, true)).toBe(1.0)
  })
})

// ---------------------------------------------------------------------------
// struct({}) throws
// ---------------------------------------------------------------------------
describe('struct — validation', () => {
  it('struct({}) throws an Error', () => {
    expect(() => struct({})).toThrow(Error)
  })

  it('struct({}) error message mentions empty fields', () => {
    expect(() => struct({})).toThrow('fields must not be empty')
  })
})

// ---------------------------------------------------------------------------
// Nested struct no longer throws — task-4 adds nested struct support.
// Full nested tests live in handle-nested.test.ts.
// ---------------------------------------------------------------------------
describe('struct — nested struct does not throw', () => {
  it('struct with a nested StructDef field succeeds', () => {
    const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
    expect(() => struct({ pos: Vec3, life: 'f32' })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// StructDef properties are typed as readonly (TS-level check)
// ---------------------------------------------------------------------------
describe('struct — StructDef shape', () => {
  it('returned object has sizeof and fields as own properties', () => {
    const Def = struct({ x: 'f64', y: 'f64', z: 'f64' })
    expect(Def.sizeof).toBe(24)
    expect(Def.fields).toStrictEqual({ x: 'f64', y: 'f64', z: 'f64' })
  })
})
