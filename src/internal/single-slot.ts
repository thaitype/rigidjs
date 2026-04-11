import type { StructDef, StructFields } from '../types.js'

/**
 * The result of createSingleSlot.
 * Provides the typed handle, the DataView, and the underlying buffer
 * for low-level byte verification in tests.
 */
export interface SingleSlot<F extends StructFields> {
  handle: InstanceType<NonNullable<StructDef<F>['_Handle']>>
  view: DataView
  buffer: ArrayBuffer
}

/**
 * Internal test-only helper. NOT re-exported from src/index.ts.
 *
 * Allocates one ArrayBuffer of size def.sizeof, wraps it in a DataView,
 * and constructs one handle at base offset 0 via the StructDef's internal
 * handle constructor (_Handle).
 *
 * Used only by milestone-1 tests to exercise handle round-trips without
 * a real container (slab/vec/bump).
 *
 * @param def A StructDef produced by struct().
 * @returns { handle, view, buffer }
 */
export function createSingleSlot<F extends StructFields>(def: StructDef<F>): SingleSlot<F> {
  if (!def._Handle) {
    throw new Error('createSingleSlot: StructDef has no _Handle — was it created by struct()?')
  }

  const buffer = new ArrayBuffer(def.sizeof)
  const view = new DataView(buffer)
  // `any` is required here to bridge the generated handle constructor's
  // opaque `object` return type to the typed SingleSlot shape.
  // This is an intentional boundary — the generated class has no static
  // TS type; `any` is isolated to this one call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = new (def._Handle as any)(view, 0, 0) as InstanceType<NonNullable<StructDef<F>['_Handle']>>

  return { handle, view, buffer }
}
