/**
 * Tests for SoA handle factory caching on StructDef (milestone-8 task-1).
 *
 * Verifies that `new Function()` is called at most once per StructDef for SoA
 * handle generation. The cached factory (`def._SoAHandleFactory`) must be the
 * same reference across multiple container instances sharing the same StructDef.
 */

import { describe, it, expect } from 'bun:test'
import { struct } from '../../src/struct/struct.js'
import { vec } from '../../src/vec/vec.js'
import { slab } from '../../src/slab/slab.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })
const Flat = struct({ a: 'f32', b: 'f32', c: 'u32' })

// ---------------------------------------------------------------------------
// Factory caching — vec instances
// ---------------------------------------------------------------------------

describe('SoA handle factory caching — vec', () => {
  it('two vec(T) SoA instances share the same _SoAHandleFactory on the StructDef', () => {
    // Start in SoA mode immediately so the factory is created on construction.
    const v1 = vec(Flat, 8)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory1 = (Flat as any)._SoAHandleFactory
    expect(factory1).toBeDefined()

    const v2 = vec(Flat, 8)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory2 = (Flat as any)._SoAHandleFactory
    expect(factory2).toBe(factory1)  // strict reference equality — same object

    v1.drop()
    v2.drop()
  })

  it('_SoAHandleFactory is set on StructDef after first SoA vec creation', () => {
    // Use a fresh struct so we can observe the before/after state.
    const T = struct({ mass: 'f64', charge: 'f32' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((T as any)._SoAHandleFactory).toBeUndefined()

    const v = vec(T, 4)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((T as any)._SoAHandleFactory).toBeDefined()

    v.drop()
  })

  it('graduation caches the factory and subsequent grows reuse it', () => {
    const T = struct({ val: 'f64', idx: 'u32' })
    // Start in JS mode; graduation will cache the factory.
    const v = vec(T)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((T as any)._SoAHandleFactory).toBeUndefined()

    // Force graduation.
    v.graduate()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factoryAfterGrad = (T as any)._SoAHandleFactory
    expect(factoryAfterGrad).toBeDefined()

    // Reserve forces a grow — factory must remain the same reference.
    v.reserve(512)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factoryAfterReserve = (T as any)._SoAHandleFactory
    expect(factoryAfterReserve).toBe(factoryAfterGrad)

    v.drop()
  })

  it('graduation works correctly with cached factory — data is preserved', () => {
    const T = struct({ x: 'f64', y: 'f64' })
    const v = vec(T)

    // Push some items in JS mode.
    const h1 = v.push(); h1.x = 1.0; h1.y = 2.0
    const h2 = v.push(); h2.x = 3.0; h2.y = 4.0

    v.graduate()

    expect(v.get(0).x).toBe(1.0)
    expect(v.get(0).y).toBe(2.0)
    expect(v.get(1).x).toBe(3.0)
    expect(v.get(1).y).toBe(4.0)

    v.drop()
  })

  it('nested struct factory is cached and produces correct handle accessors', () => {
    // Particle has nested Vec3 sub-structs — tests the recursive factory logic.
    const v1 = vec(Particle, 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f1 = (Particle as any)._SoAHandleFactory

    const v2 = vec(Particle, 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f2 = (Particle as any)._SoAHandleFactory

    expect(f1).toBeDefined()
    expect(f2).toBe(f1)

    // Verify handles from each vec work correctly after factory reuse.
    const h = v1.push()
    h.pos.x = 1.5
    h.pos.y = 2.5
    h.pos.z = 3.5
    h.life = 0.9

    expect(v1.get(0).pos.x).toBe(1.5)
    expect(v1.get(0).pos.y).toBe(2.5)
    expect(v1.get(0).pos.z).toBe(3.5)
    expect(v1.get(0).life).toBeCloseTo(0.9, 5)

    v1.drop()
    v2.drop()
  })
})

// ---------------------------------------------------------------------------
// Factory caching — slab instances
// ---------------------------------------------------------------------------

describe('SoA handle factory caching — slab', () => {
  it('two slab(T, n) instances share the same _SoAHandleFactory on the StructDef', () => {
    // Use a fresh struct to observe caching independently.
    const T = struct({ energy: 'f64', id: 'u32' })

    const s1 = slab(T, 8)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory1 = (T as any)._SoAHandleFactory
    expect(factory1).toBeDefined()

    const s2 = slab(T, 16)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory2 = (T as any)._SoAHandleFactory
    expect(factory2).toBe(factory1)

    s1.drop()
    s2.drop()
  })

  it('slab and vec share the same _SoAHandleFactory when using the same StructDef', () => {
    const T = struct({ px: 'f32', py: 'f32', pz: 'f32' })

    const v = vec(T, 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factoryFromVec = (T as any)._SoAHandleFactory
    expect(factoryFromVec).toBeDefined()

    const s = slab(T, 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factoryFromSlab = (T as any)._SoAHandleFactory
    expect(factoryFromSlab).toBe(factoryFromVec)

    v.drop()
    s.drop()
  })

  it('slab insert/get work correctly with cached factory', () => {
    const T = struct({ val: 'f64', tag: 'u8' })
    slab(T, 4)  // prime the cache
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cachedFactory = (T as any)._SoAHandleFactory

    // Second slab uses cached factory.
    const s = slab(T, 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((T as any)._SoAHandleFactory).toBe(cachedFactory)

    const h = s.insert()
    h.val = 42.0
    h.tag = 7

    expect(s.get(0).val).toBe(42.0)
    expect(s.get(0).tag).toBe(7)

    s.drop()
  })
})
