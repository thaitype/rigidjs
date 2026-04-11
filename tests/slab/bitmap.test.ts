import { describe, expect, it } from 'bun:test'
import {
  bitmapByteLength,
  bitmapClear,
  bitmapGet,
  bitmapSet,
} from '../../src/slab/bitmap.ts'

describe('bitmapGet — initial state', () => {
  it('freshly-created Uint8Array reports false for all bits', () => {
    const bytes = new Uint8Array(4)
    for (let i = 0; i < 32; i++) {
      expect(bitmapGet(bytes, i)).toBe(false)
    }
  })
})

describe('bitmapSet / bitmapGet — round-trip', () => {
  it('set(i) makes get(i) true', () => {
    const bytes = new Uint8Array(4)
    bitmapSet(bytes, 5)
    expect(bitmapGet(bytes, 5)).toBe(true)
  })

  it('clear(i) after set(i) makes get(i) false', () => {
    const bytes = new Uint8Array(4)
    bitmapSet(bytes, 5)
    bitmapClear(bytes, 5)
    expect(bitmapGet(bytes, 5)).toBe(false)
  })
})

describe('bitmapSet — independence (setting bit 3 does not affect neighbours)', () => {
  it('bits 0, 1, 2, 4 remain false after set(3)', () => {
    const bytes = new Uint8Array(1)
    bitmapSet(bytes, 3)
    expect(bitmapGet(bytes, 0)).toBe(false)
    expect(bitmapGet(bytes, 1)).toBe(false)
    expect(bitmapGet(bytes, 2)).toBe(false)
    expect(bitmapGet(bytes, 4)).toBe(false)
  })

  it('bit 3 is true after set(3)', () => {
    const bytes = new Uint8Array(1)
    bitmapSet(bytes, 3)
    expect(bitmapGet(bytes, 3)).toBe(true)
  })
})

describe('byte-boundary crossings', () => {
  it('bit 7 lives in byte 0', () => {
    const bytes = new Uint8Array(2)
    bitmapSet(bytes, 7)
    expect(bytes[0]).toBe(1 << 7)
    expect(bytes[1]).toBe(0)
    expect(bitmapGet(bytes, 7)).toBe(true)
  })

  it('bit 8 lives in byte 1', () => {
    const bytes = new Uint8Array(2)
    bitmapSet(bytes, 8)
    expect(bytes[0]).toBe(0)
    expect(bytes[1]).toBe(1 << 0)
    expect(bitmapGet(bytes, 8)).toBe(true)
  })

  it('bit 15 lives in byte 1', () => {
    const bytes = new Uint8Array(2)
    bitmapSet(bytes, 15)
    expect(bytes[0]).toBe(0)
    expect(bytes[1]).toBe(1 << 7)
    expect(bitmapGet(bytes, 15)).toBe(true)
  })

  it('bit 16 lives in byte 2', () => {
    const bytes = new Uint8Array(3)
    bitmapSet(bytes, 16)
    expect(bytes[0]).toBe(0)
    expect(bytes[1]).toBe(0)
    expect(bytes[2]).toBe(1 << 0)
    expect(bitmapGet(bytes, 16)).toBe(true)
  })
})

describe('bitmapByteLength', () => {
  it('bitmapByteLength(0) === 0', () => {
    expect(bitmapByteLength(0)).toBe(0)
  })

  it('bitmapByteLength(1) === 1', () => {
    expect(bitmapByteLength(1)).toBe(1)
  })

  it('bitmapByteLength(8) === 1', () => {
    expect(bitmapByteLength(8)).toBe(1)
  })

  it('bitmapByteLength(9) === 2', () => {
    expect(bitmapByteLength(9)).toBe(2)
  })

  it('bitmapByteLength(100) === 13', () => {
    expect(bitmapByteLength(100)).toBe(13)
  })
})

describe('capacity 1000 — spot checks', () => {
  it('bits 0, 1, 500, 999 set and get correctly', () => {
    const bytes = new Uint8Array(bitmapByteLength(1000))

    bitmapSet(bytes, 0)
    bitmapSet(bytes, 1)
    bitmapSet(bytes, 500)
    bitmapSet(bytes, 999)

    expect(bitmapGet(bytes, 0)).toBe(true)
    expect(bitmapGet(bytes, 1)).toBe(true)
    expect(bitmapGet(bytes, 500)).toBe(true)
    expect(bitmapGet(bytes, 999)).toBe(true)

    // Sanity: adjacent bits are untouched
    expect(bitmapGet(bytes, 2)).toBe(false)
    expect(bitmapGet(bytes, 499)).toBe(false)
    expect(bitmapGet(bytes, 501)).toBe(false)
    expect(bitmapGet(bytes, 998)).toBe(false)
  })
})
