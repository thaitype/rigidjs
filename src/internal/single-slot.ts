import type { StructDef, StructFields } from '../types.js'
import { slab } from '../slab/slab.js'

/**
 * The result of createSingleSlot.
 * Provides the typed handle, a DataView over the backing buffer, and the
 * underlying buffer itself for low-level byte verification in tests.
 *
 * NOTE (milestone-3): The internal storage is SoA — each column occupies a
 * separate TypedArray sub-range of the buffer. For a capacity-1 slab,
 * column[i] starts at byte `byteOffset * 1 = byteOffset` in the buffer
 * (same as the per-slot byte offset). DataView reads at these offsets still
 * reflect written values correctly.
 */
export interface SingleSlot<F extends StructFields> {
  handle: object
  view: DataView
  buffer: ArrayBuffer
}

/**
 * Internal test-only helper. NOT re-exported from src/index.ts.
 *
 * Creates a 1-capacity slab for the given struct definition, inserts one slot,
 * and returns the handle, a DataView over the backing buffer, and the buffer
 * itself for raw byte verification in tests.
 *
 * Using slab(def, 1) means the single-slot layout is:
 *   - capacity=1: bufByteOffset = colByteOffset * 1 = colByteOffset
 *   - Each column's TypedArray starts at its per-slot byte offset
 *   - DataView reads at these offsets return the correct values
 *
 * @param def A StructDef produced by struct().
 * @returns { handle, view, buffer }
 */
export function createSingleSlot<F extends StructFields>(def: StructDef<F>): SingleSlot<F> {
  const s = slab(def, 1)
  const handle = s.insert() as object
  const buf = s.buffer
  const view = new DataView(buf)
  return { handle, view, buffer: buf }
}
