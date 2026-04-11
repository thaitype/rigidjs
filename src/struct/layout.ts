import type { FieldType, StructFields } from '../types.js'
import { NUMERIC_SIZES } from '../types.js'

/**
 * Returns true when `t` is a numeric type token (string literal).
 */
export function isNumericType(t: FieldType): t is string & keyof typeof NUMERIC_SIZES {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(NUMERIC_SIZES, t)
}

/**
 * Result shape returned by computeLayout.
 * Each entry in `offsets` gives the absolute byte offset of the field
 * within the struct and the field's type.
 *
 * Note: dotted-path resolution for nested sub-fields is task-4 scope.
 * Only top-level field names are keyed here.
 */
export interface LayoutResult {
  sizeof: number
  offsets: ReadonlyMap<string, { offset: number; type: FieldType }>
}

/**
 * Pure function that computes the byte layout for a set of struct fields.
 *
 * Rules (from _standard/memory-and-perf.md §6):
 *  - Declaration order, no padding.
 *  - Numeric field contributes its byte size.
 *  - Nested StructDef contributes nested.sizeof bytes (inlined).
 *
 * Throws if the field map is empty.
 */
export function computeLayout(fields: StructFields): LayoutResult {
  const keys = Object.keys(fields)

  if (keys.length === 0) {
    throw new Error('computeLayout: fields must not be empty — a struct requires at least one field')
  }

  const offsets = new Map<string, { offset: number; type: FieldType }>()
  let cursor = 0

  for (const key of keys) {
    // keys comes from Object.keys(fields), so each key is guaranteed to exist.
    // The non-null assertion handles noUncheckedIndexedAccess.
    const fieldType = fields[key]!
    offsets.set(key, { offset: cursor, type: fieldType })

    if (isNumericType(fieldType)) {
      cursor += NUMERIC_SIZES[fieldType]
    } else {
      // Nested StructDef — inline its bytes at the current cursor position.
      cursor += fieldType.sizeof
    }
  }

  return { sizeof: cursor, offsets }
}
