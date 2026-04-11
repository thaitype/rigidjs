import type { StructDef, StructFields } from '../types.js'
import { computeLayout } from './layout.js'
import { generateHandleClass } from './handle-codegen.js'

/**
 * Defines a fixed-layout struct blueprint.
 *
 * - Pure: no ArrayBuffer is allocated.
 * - `computeLayout` is called once to compute field offsets and sizeof.
 * - `generateHandleClass` is called once to produce the code-generated handle constructor.
 * - The returned StructDef carries `sizeof` and `fields` as readonly public members.
 * - `_Handle` and `_offsets` are internal-only implementation details attached
 *   for use by containers (slab, vec, bump) in later milestones.
 *
 * Throws if `fields` is empty (delegated to `computeLayout`).
 *
 * @param fields An object literal mapping field names to numeric type tokens or nested StructDefs.
 * @returns A StructDef blueprint.
 */
export function struct<const F extends StructFields>(fields: F): StructDef<F> {
  const layout = computeLayout(fields)
  const Handle = generateHandleClass(fields, layout.offsets)

  return {
    sizeof: layout.sizeof,
    fields,
    _Handle: Handle,
    _offsets: layout.offsets,
  }
}
