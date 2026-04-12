import { describe, it, expect } from 'bun:test'
import { computeColumnLayout, computeLayout } from '../../src/struct/layout.js'
import { struct } from '../../src/struct/struct.js'
import type { StructFields } from '../../src/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Vec3Fields: StructFields = { x: 'f64', y: 'f64', z: 'f64' }
const Vec3 = struct(Vec3Fields)

// ---------------------------------------------------------------------------
// Basic Vec3 layout — three f64 columns
// ---------------------------------------------------------------------------

describe('computeColumnLayout — Vec3 (3×f64)', () => {
  const layout = computeColumnLayout(Vec3Fields)

  it('returns 3 columns', () => {
    expect(layout.columns.length).toBe(3)
  })

  it('sizeofPerSlot === 24', () => {
    expect(layout.sizeofPerSlot).toBe(24)
  })

  it('column x has byteOffset 0', () => {
    const col = layout.columnMap.get('x')
    expect(col).toBeDefined()
    expect(col!.byteOffset).toBe(0)
  })

  it('column y has byteOffset 8', () => {
    const col = layout.columnMap.get('y')
    expect(col).toBeDefined()
    expect(col!.byteOffset).toBe(8)
  })

  it('column z has byteOffset 16', () => {
    const col = layout.columnMap.get('z')
    expect(col).toBeDefined()
    expect(col!.byteOffset).toBe(16)
  })
})

// ---------------------------------------------------------------------------
// Natural-alignment sort: f64 before f32
// { life: 'f32', pos: Vec3 }  →  pos.x at 0, pos.y at 8, pos.z at 16, life at 24
// ---------------------------------------------------------------------------

describe('computeColumnLayout — natural alignment sort (f64 before f32)', () => {
  // Declare f32 first to test that the sort reorders it after f64 columns.
  const fields: StructFields = { life: 'f32', pos: Vec3 }
  const layout = computeColumnLayout(fields)

  it('returns 4 columns', () => {
    expect(layout.columns.length).toBe(4)
  })

  it('pos.x at byteOffset 0 (f64 sorts first)', () => {
    const col = layout.columnMap.get('pos.x')
    expect(col).toBeDefined()
    expect(col!.byteOffset).toBe(0)
  })

  it('pos.y at byteOffset 8', () => {
    const col = layout.columnMap.get('pos.y')
    expect(col).toBeDefined()
    expect(col!.byteOffset).toBe(8)
  })

  it('pos.z at byteOffset 16', () => {
    const col = layout.columnMap.get('pos.z')
    expect(col).toBeDefined()
    expect(col!.byteOffset).toBe(16)
  })

  it('life at byteOffset 24 (f32, after all f64 columns)', () => {
    const col = layout.columnMap.get('life')
    expect(col).toBeDefined()
    expect(col!.byteOffset).toBe(24)
  })

  it('life byteOffset is a multiple of 4 (f32 alignment)', () => {
    const col = layout.columnMap.get('life')
    expect(col!.byteOffset % 4).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Particle struct — full mixed struct with nested Vec3s
// { pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' }
// f64 cols: pos.x, pos.y, pos.z, vel.x, vel.y, vel.z  → offsets 0..40
// f32/u32 cols: life, id                               → offsets 48, 52
// ---------------------------------------------------------------------------

describe('computeColumnLayout — Particle (pos/vel Vec3, life f32, id u32)', () => {
  const ParticleFields: StructFields = { pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' }
  const layout = computeColumnLayout(ParticleFields)

  it('returns 8 columns', () => {
    expect(layout.columns.length).toBe(8)
  })

  it('sizeofPerSlot === 56', () => {
    expect(layout.sizeofPerSlot).toBe(56)
  })

  it('all f64 columns land before f32/u32 columns', () => {
    const f64Cols = layout.columns.filter(c => c.token === 'f64')
    const f32Cols = layout.columns.filter(c => c.token === 'f32' || c.token === 'u32')
    const maxF64Offset = Math.max(...f64Cols.map(c => c.byteOffset))
    const minF32Offset = Math.min(...f32Cols.map(c => c.byteOffset))
    expect(maxF64Offset).toBeLessThan(minF32Offset)
  })

  it('all column byteOffsets satisfy alignment', () => {
    for (const col of layout.columns) {
      expect(col.byteOffset % col.elementSize).toBe(0)
    }
  })

  // Dotted keys are present in the columnMap
  it('pos.x, pos.y, pos.z present in columnMap', () => {
    expect(layout.columnMap.has('pos.x')).toBe(true)
    expect(layout.columnMap.has('pos.y')).toBe(true)
    expect(layout.columnMap.has('pos.z')).toBe(true)
  })

  it('vel.x, vel.y, vel.z present in columnMap', () => {
    expect(layout.columnMap.has('vel.x')).toBe(true)
    expect(layout.columnMap.has('vel.y')).toBe(true)
    expect(layout.columnMap.has('vel.z')).toBe(true)
  })

  it('life and id present in columnMap', () => {
    expect(layout.columnMap.has('life')).toBe(true)
    expect(layout.columnMap.has('id')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Alignment check: f32 after f64 has byteOffset % 4 === 0
// ---------------------------------------------------------------------------

describe('computeColumnLayout — f32 alignment after f64 fields', () => {
  const fields: StructFields = { x: 'f64', y: 'f64', z: 'f64', w: 'f32' }
  const layout = computeColumnLayout(fields)

  it('w (f32) byteOffset is a multiple of 4', () => {
    const col = layout.columnMap.get('w')
    expect(col).toBeDefined()
    expect(col!.byteOffset % 4).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Completeness check: every leaf field appears exactly once
// ---------------------------------------------------------------------------

describe('computeColumnLayout — completeness', () => {
  it('Vec3 fields all appear exactly once', () => {
    const layout = computeColumnLayout(Vec3Fields)
    const names = layout.columns.map(c => c.name)
    expect(names.sort()).toEqual(['x', 'y', 'z'])
  })

  it('mixed-size struct fields all appear exactly once', () => {
    const fields: StructFields = { a: 'u8', b: 'u16', c: 'u32', d: 'f64' }
    const layout = computeColumnLayout(fields)
    const names = layout.columns.map(c => c.name).sort()
    expect(names).toEqual(['a', 'b', 'c', 'd'])
  })

  it('nested Particle fields all appear exactly once', () => {
    const fields: StructFields = { pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' }
    const layout = computeColumnLayout(fields)
    const names = layout.columns.map(c => c.name).sort()
    expect(names).toEqual(['id', 'life', 'pos.x', 'pos.y', 'pos.z', 'vel.x', 'vel.y', 'vel.z'])
  })
})

// ---------------------------------------------------------------------------
// sizeof parity: sizeofPerSlot === computeLayout(fields).sizeof for 3 fixtures
// ---------------------------------------------------------------------------

describe('computeColumnLayout — sizeof parity with computeLayout', () => {
  it('Vec3: sizeofPerSlot === computeLayout sizeof', () => {
    const layout = computeColumnLayout(Vec3Fields)
    const old = computeLayout(Vec3Fields)
    expect(layout.sizeofPerSlot).toBe(old.sizeof)
  })

  it('mixed-type struct: sizeofPerSlot === computeLayout sizeof', () => {
    const fields: StructFields = { a: 'u8', b: 'u16', c: 'u32', d: 'f64' }
    const layout = computeColumnLayout(fields)
    const old = computeLayout(fields)
    expect(layout.sizeofPerSlot).toBe(old.sizeof)
  })

  it('Particle: sizeofPerSlot === computeLayout sizeof', () => {
    const fields: StructFields = { pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' }
    const layout = computeColumnLayout(fields)
    const old = computeLayout(fields)
    expect(layout.sizeofPerSlot).toBe(old.sizeof)
  })
})

// ---------------------------------------------------------------------------
// HandleTree structure
// ---------------------------------------------------------------------------

describe('computeColumnLayout — handleTree', () => {
  it('Vec3 handleTree has 3 numeric fields and 0 nested fields', () => {
    const layout = computeColumnLayout(Vec3Fields)
    expect(layout.handleTree.numericFields.length).toBe(3)
    expect(layout.handleTree.nestedFields.length).toBe(0)
  })

  it('Particle handleTree has 2 numeric fields (life, id) and 2 nested fields (pos, vel)', () => {
    const fields: StructFields = { pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' }
    const layout = computeColumnLayout(fields)
    expect(layout.handleTree.numericFields.length).toBe(2)
    expect(layout.handleTree.nestedFields.length).toBe(2)
  })

  it('Particle nested pos handleTree child has 3 numeric fields', () => {
    const fields: StructFields = { pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' }
    const layout = computeColumnLayout(fields)
    const posChild = layout.handleTree.nestedFields.find(f => f.name === 'pos')
    expect(posChild).toBeDefined()
    expect(posChild!.child.numericFields.length).toBe(3)
  })
})
