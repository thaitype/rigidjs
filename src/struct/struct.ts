import type { StructDef, StructFields } from '../types.js'
import { computeLayout, computeColumnLayout } from './layout.js'

/**
 * Defines a fixed-layout struct blueprint.
 *
 * - Pure: no ArrayBuffer is allocated.
 * - `computeColumnLayout` is called once to compute SoA field offsets and sizeof.
 * - `_columnLayout` is attached for containers (slab, vec, bump) to consume.
 * - `_offsets` (AoS layout) is preserved for milestone-1 test compatibility.
 * - `_Handle` is NOT set by struct() from milestone-3 onward. Containers generate
 *   the handle class themselves when they know the capacity. Use `createSingleSlot`
 *   or a 1-capacity slab to exercise handles in tests.
 *
 * Throws if `fields` is empty (delegated to `computeColumnLayout`).
 *
 * @param fields An object literal mapping field names to numeric type tokens or nested StructDefs.
 * @returns A StructDef blueprint.
 */
export function struct<const F extends StructFields>(fields: F): StructDef<F> {
  const columnLayout = computeColumnLayout(fields)

  // _offsets is preserved from the AoS layout computation for milestone-1 test compatibility
  // (public-api.test.ts checks Particle._offsets). Not used by SoA containers.
  const aosLayout = computeLayout(fields)

  return {
    sizeof: columnLayout.sizeofPerSlot,
    fields,
    // _Handle is intentionally not set — containers (slab) build the handle class
    // at construction time when they know the capacity and can build real TypedArray views.
    // Use createSingleSlot(def) or slab(def, 1) to exercise handle behavior in tests.
    _offsets: aosLayout.offsets,
    _columnLayout: columnLayout,
  }
}
