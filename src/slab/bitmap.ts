/**
 * Occupancy bitmap primitives — single source of truth for the bit layout.
 *
 * Convention:
 *   byte index = index >> 3          (8 bits per byte)
 *   bit mask   = 1 << (index & 7)   (bit position within that byte)
 *   occupied   iff (bytes[byteIdx] & mask) !== 0
 *
 * All three functions are allocation-free and carry zero temporaries.
 * Internal to `src/slab/` — NOT re-exported from `src/index.ts`.
 */

/**
 * Mark slot `index` as occupied.
 * ORs the bit mask into the corresponding byte.
 *
 * @param bytes  - occupancy bitmap (Uint8Array)
 * @param index  - slot index
 */
export function bitmapSet(bytes: Uint8Array, index: number): void {
  bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (index & 7))
}

/**
 * Mark slot `index` as free.
 * ANDs the complement of the bit mask into the corresponding byte.
 *
 * @param bytes  - occupancy bitmap (Uint8Array)
 * @param index  - slot index
 */
export function bitmapClear(bytes: Uint8Array, index: number): void {
  bytes[index >> 3] = (bytes[index >> 3] ?? 0) & ~(1 << (index & 7))
}

/**
 * Return `true` iff slot `index` is currently occupied.
 * Reads the bit mask from the corresponding byte.
 *
 * @param bytes  - occupancy bitmap (Uint8Array)
 * @param index  - slot index
 */
export function bitmapGet(bytes: Uint8Array, index: number): boolean {
  return ((bytes[index >> 3] ?? 0) & (1 << (index & 7))) !== 0
}

/**
 * Return the number of bytes needed to hold `capacity` bits.
 * Keeps the size formula in one place so `slab()` and tests agree.
 *
 * @param capacity  - number of slots
 */
export function bitmapByteLength(capacity: number): number {
  return Math.ceil(capacity / 8)
}
