/**
 * End-to-end test for the SoA handle codegen (generateSoAHandleClass).
 *
 * This test exercises the new SoA path in isolation — without touching the slab,
 * which still uses the old AoS + DataView codegen during task-2.
 *
 * Test coverage:
 *  1. Define a struct with multiple numeric types and a nested struct (Vec3 inside Particle).
 *  2. Compute the column layout.
 *  3. Allocate a single ArrayBuffer based on sizeofPerSlot * capacity.
 *  4. Build the column map by constructing each TypedArray view at its byteOffset.
 *  5. Instantiate the generated handle class.
 *  6. Write field values and read them back.
 *  7. Verify values round-trip correctly.
 *  8. Verify the byte layout via raw DataView.
 *  9. Verify _rebase(slot) correctly rebases the handle and sub-handles.
 */
import { describe, it, expect } from 'bun:test'
import { computeColumnLayout } from '../../src/struct/layout.js'
import { generateSoAHandleClass } from '../../src/struct/handle-codegen.js'
import type { ColumnRef } from '../../src/struct/handle-codegen.js'
import { struct } from '../../src/struct/struct.js'
import type { StructFields } from '../../src/types.js'

// ---------------------------------------------------------------------------
// Helpers: build the in-memory column map from a ColumnLayout + single buffer
// ---------------------------------------------------------------------------

/**
 * Allocates a single ArrayBuffer of size `sizeofPerSlot * capacity` and
 * constructs one TypedArray view per column at its byteOffset into that buffer.
 * Returns the buffer and the columnRefs map ready for generateSoAHandleClass.
 */
function buildColumnRefs(
  layout: ReturnType<typeof computeColumnLayout>,
  capacity: number,
): { buffer: ArrayBuffer; columnRefs: Map<string, ColumnRef> } {
  const buffer = new ArrayBuffer(layout.sizeofPerSlot * capacity)
  const columnRefs = new Map<string, ColumnRef>()

  for (const col of layout.columns) {
    const byteOffset = col.byteOffset * capacity  // column starts at this byte in buffer
    const length = capacity
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypedArray ctor from layout, any needed here
    const array = new (col.typedArrayCtor as any)(buffer, byteOffset, length) as
      Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array
    columnRefs.set(col.name, { name: col.name, array })
  }

  return { buffer, columnRefs }
}

// ---------------------------------------------------------------------------
// Test struct definitions
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

// Particle: pos (Vec3), vel (Vec3), life (f32), id (u32)
const ParticleFields: StructFields = { pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' }

// ---------------------------------------------------------------------------
// Helper type for generated handle (runtime-only cast for test code)
// ---------------------------------------------------------------------------

interface ParticleHandle {
  pos: { x: number; y: number; z: number }
  vel: { x: number; y: number; z: number }
  life: number
  id: number
  slot: number
  _rebase(slot: number): unknown
}

// ---------------------------------------------------------------------------
// 1. Column layout produces correct structure for Particle
// ---------------------------------------------------------------------------

describe('SoA codegen — Particle column layout', () => {
  const layout = computeColumnLayout(ParticleFields)

  it('produces 8 columns (6 f64, 1 f32, 1 u32)', () => {
    expect(layout.columns.length).toBe(8)
  })

  it('sizeofPerSlot === 56', () => {
    expect(layout.sizeofPerSlot).toBe(56)
  })

  it('all f64 columns sorted before f32/u32', () => {
    const f64Count = layout.columns.filter(c => c.token === 'f64').length
    const nonF64 = layout.columns.filter(c => c.token !== 'f64')
    for (const col of nonF64) {
      // Every non-f64 column must appear after all f64 columns in the sorted list
      const idx = layout.columns.indexOf(col)
      expect(idx).toBeGreaterThanOrEqual(f64Count)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Handle class instantiation and field write/read round-trip
// ---------------------------------------------------------------------------

describe('SoA codegen — Particle handle round-trip (capacity 1)', () => {
  const CAPACITY = 1
  const layout = computeColumnLayout(ParticleFields)
  const { columnRefs } = buildColumnRefs(layout, CAPACITY)
  const HandleCtor = generateSoAHandleClass(layout.handleTree, columnRefs)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque generated class
  const h = new (HandleCtor as any)(0) as ParticleHandle

  it('handle instantiates without error', () => {
    expect(h).toBeDefined()
  })

  it('slot getter returns 0 for initial slot', () => {
    expect(h.slot).toBe(0)
  })

  it('pos sub-handle is accessible (not undefined)', () => {
    expect(h.pos).toBeDefined()
  })

  it('vel sub-handle is accessible (not undefined)', () => {
    expect(h.vel).toBeDefined()
  })

  it('pos === pos (sub-handle identity — no per-access allocation)', () => {
    expect(h.pos).toBe(h.pos)
  })

  it('vel === vel (sub-handle identity)', () => {
    expect(h.vel).toBe(h.vel)
  })

  it('writes and reads back pos.x = 1.5', () => {
    h.pos.x = 1.5
    expect(h.pos.x).toBe(1.5)
  })

  it('writes and reads back pos.y = 2.5', () => {
    h.pos.y = 2.5
    expect(h.pos.y).toBe(2.5)
  })

  it('writes and reads back pos.z = 3.5', () => {
    h.pos.z = 3.5
    expect(h.pos.z).toBe(3.5)
  })

  it('writes and reads back vel.x = -1', () => {
    h.vel.x = -1
    expect(h.vel.x).toBe(-1)
  })

  it('writes and reads back vel.y = -2', () => {
    h.vel.y = -2
    expect(h.vel.y).toBe(-2)
  })

  it('writes and reads back vel.z = -3', () => {
    h.vel.z = -3
    expect(h.vel.z).toBe(-3)
  })

  it('writes and reads back id = 42 (u32 round-trip)', () => {
    h.id = 42
    expect(h.id).toBe(42)
  })

  it('writes and reads back life = 0.75 (f32 round-trip within precision)', () => {
    h.life = 0.75
    // f32 round-trip: verify via Float32Array
    const tmp = new Float32Array(1)
    tmp[0] = 0.75
    expect(h.life).toBe(tmp[0])
  })
})

// ---------------------------------------------------------------------------
// 3. Byte layout verification via raw DataView
// ---------------------------------------------------------------------------

describe('SoA codegen — byte layout verification (Particle, capacity 4)', () => {
  const CAPACITY = 4
  const layout = computeColumnLayout(ParticleFields)
  const { buffer, columnRefs } = buildColumnRefs(layout, CAPACITY)
  const HandleCtor = generateSoAHandleClass(layout.handleTree, columnRefs)
  const view = new DataView(buffer)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque generated class
  const h = new (HandleCtor as any)(0) as ParticleHandle

  it('writing pos.x for slot 0 appears at column\'s byteOffset in the buffer', () => {
    h.pos.x = 99.5
    // pos.x is f64 — its column byteOffset in the layout * CAPACITY gives the start
    // of the pos.x column. Slot 0 is at index 0, so buffer byte = col.byteOffset * CAPACITY.
    const posXCol = layout.columnMap.get('pos.x')!
    const bufByteOffset = posXCol.byteOffset * CAPACITY  // column start in buffer
    expect(view.getFloat64(bufByteOffset, true)).toBe(99.5)
  })

  it('writing id for slot 0 appears at the id column\'s position in the buffer', () => {
    h.id = 7
    const idCol = layout.columnMap.get('id')!
    const bufByteOffset = idCol.byteOffset * CAPACITY  // column start in buffer
    expect(view.getUint32(bufByteOffset, true)).toBe(7)
  })

  it('columns are non-overlapping: writing one does not corrupt another', () => {
    h.pos.x = 11.1
    h.id = 55
    h.life = 0.5
    expect(h.pos.x).toBe(11.1)
    expect(h.id).toBe(55)
    // f32 precision check
    const tmp = new Float32Array(1)
    tmp[0] = 0.5
    expect(h.life).toBe(tmp[0])
  })
})

// ---------------------------------------------------------------------------
// 4. _rebase — handle correctly rebases to different slots
// ---------------------------------------------------------------------------

describe('SoA codegen — _rebase across multiple slots', () => {
  const CAPACITY = 3
  const layout = computeColumnLayout(ParticleFields)
  const { columnRefs } = buildColumnRefs(layout, CAPACITY)
  const HandleCtor = generateSoAHandleClass(layout.handleTree, columnRefs)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque generated class
  const h = new (HandleCtor as any)(0) as ParticleHandle

  it('slot 0 write does not affect slot 1 after rebase', () => {
    // Write to slot 0
    h.pos.x = 10
    h.id = 1

    // Rebase to slot 1
    h._rebase(1)
    expect(h.slot).toBe(1)

    // Write to slot 1 — different values
    h.pos.x = 20
    h.id = 2

    // Rebase back to slot 0 — slot 0 should still have original values
    h._rebase(0)
    expect(h.slot).toBe(0)
    expect(h.pos.x).toBe(10)
    expect(h.id).toBe(1)

    // Rebase to slot 1 — should have the values set for slot 1
    h._rebase(1)
    expect(h.slot).toBe(1)
    expect(h.pos.x).toBe(20)
    expect(h.id).toBe(2)
  })

  it('_rebase propagates to sub-handles (pos.x reads from correct slot)', () => {
    h._rebase(0)
    h.pos.x = 100
    h._rebase(2)
    h.pos.x = 300

    h._rebase(0)
    expect(h.pos.x).toBe(100)

    h._rebase(2)
    expect(h.pos.x).toBe(300)
  })

  it('sub-handle identity is preserved after rebase (h.pos === h.pos)', () => {
    h._rebase(0)
    const posRef = h.pos
    h._rebase(1)
    // The sub-handle instance should be the same object (just rebased internally)
    expect(h.pos).toBe(posRef)
  })

  it('_rebase sets slot on sub-handles (sub-handle slot follows parent)', () => {
    h._rebase(2)
    expect(h.slot).toBe(2)
    // Verify the sub-handle reads from slot 2 (indirectly via writes)
    h.pos.y = 77
    h._rebase(0)
    h.pos.y = 11
    h._rebase(2)
    expect(h.pos.y).toBe(77)
  })
})

// ---------------------------------------------------------------------------
// 5. Multiple independent handles from the same column map
// ---------------------------------------------------------------------------

describe('SoA codegen — multiple handles sharing the same column refs', () => {
  const CAPACITY = 2
  const layout = computeColumnLayout(ParticleFields)
  const { columnRefs } = buildColumnRefs(layout, CAPACITY)
  const HandleCtor = generateSoAHandleClass(layout.handleTree, columnRefs)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque generated class
  const h0 = new (HandleCtor as any)(0) as ParticleHandle
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h1 = new (HandleCtor as any)(1) as ParticleHandle

  it('two handles on different slots are independent', () => {
    h0.pos.x = 1.1
    h1.pos.x = 9.9

    expect(h0.pos.x).toBe(1.1)
    expect(h1.pos.x).toBe(9.9)
  })

  it('writing via h0 is visible through h1 after rebasing h1 to slot 0', () => {
    h0.id = 99
    h1._rebase(0)
    expect(h1.id).toBe(99)
  })
})

// ---------------------------------------------------------------------------
// 6. Simple flat struct (no nested fields) — Vec3 only
// ---------------------------------------------------------------------------

describe('SoA codegen — flat Vec3 struct', () => {
  const CAPACITY = 2
  const Vec3Fields: StructFields = { x: 'f64', y: 'f64', z: 'f64' }
  const layout = computeColumnLayout(Vec3Fields)
  const { columnRefs } = buildColumnRefs(layout, CAPACITY)
  const HandleCtor = generateSoAHandleClass(layout.handleTree, columnRefs)

  interface Vec3Handle {
    x: number; y: number; z: number; slot: number
    _rebase(s: number): unknown
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = new (HandleCtor as any)(0) as Vec3Handle

  it('writes and reads x, y, z', () => {
    h.x = 1; h.y = 2; h.z = 3
    expect(h.x).toBe(1)
    expect(h.y).toBe(2)
    expect(h.z).toBe(3)
  })

  it('_rebase works for flat struct', () => {
    h._rebase(0); h.x = 10
    h._rebase(1); h.x = 20
    h._rebase(0)
    expect(h.x).toBe(10)
    h._rebase(1)
    expect(h.x).toBe(20)
  })
})
