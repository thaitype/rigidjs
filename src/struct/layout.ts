import type { FieldType, NumericType, StructFields } from '../types.js'
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

// ---------------------------------------------------------------------------
// SoA column layout (milestone-3)
// ---------------------------------------------------------------------------

/**
 * TypedArray constructor type alias.
 * Internal — not re-exported.
 */
export type TypedArrayCtor =
  | typeof Float64Array
  | typeof Float32Array
  | typeof Uint32Array
  | typeof Uint16Array
  | typeof Uint8Array
  | typeof Int32Array
  | typeof Int16Array
  | typeof Int8Array

/**
 * Maps each NumericType token to its TypedArray constructor.
 * Used by computeColumnLayout to emit column descriptors.
 */
const TYPED_ARRAY_CTORS: Record<NumericType, TypedArrayCtor> = {
  f64: Float64Array,
  f32: Float32Array,
  u32: Uint32Array,
  u16: Uint16Array,
  u8:  Uint8Array,
  i32: Int32Array,
  i16: Int16Array,
  i8:  Int8Array,
}

/**
 * One column in the flattened SoA layout.
 * Exported so the codegen and slab can consume column descriptors.
 */
export interface ColumnDesc {
  /** Flattened dotted-key name, e.g. 'pos.x', 'life', 'id'. */
  name: string
  /** Numeric token for this column, e.g. 'f64'. */
  token: NumericType
  /** Byte size of one element for this column's TypedArray subclass. */
  elementSize: number
  /** TypedArray constructor for this column. */
  typedArrayCtor: TypedArrayCtor
  /**
   * Byte offset of this column's first element inside the struct's single buffer,
   * per slot. Multiple of elementSize (natural alignment guaranteed by sort order).
   * At the ColumnLayout level this is a per-slot offset; the slab multiplies by
   * capacity to get the per-column byte range in the actual ArrayBuffer.
   */
  byteOffset: number
  /**
   * Byte length of the column across all slots (elementSize * capacity).
   * Filled to 0 here — the slab fills it in at construction time.
   */
  byteLength: 0
}

/**
 * A single node in the handle-tree representation of a struct's field hierarchy.
 * The tree mirrors declaration order so the generated handle class exposes fields
 * in the order the user declared them.
 */
export interface HandleNode {
  /** Field path from the root handle (empty string for the root node). */
  path: string
  /**
   * Numeric fields declared at this level, in declaration order.
   * Each entry carries the field name (not dotted — relative to this level)
   * and a reference to the ColumnDesc for the corresponding column.
   */
  numericFields: ReadonlyArray<{ name: string; column: ColumnDesc }>
  /**
   * Nested struct fields declared at this level, in declaration order.
   * Each entry carries the field name and the child HandleNode.
   */
  nestedFields: ReadonlyArray<{ name: string; child: HandleNode }>
}

/**
 * Complete result of computeColumnLayout.
 */
export interface ColumnLayout {
  /**
   * Sum of column element sizes per slot — equals the old sizeof from computeLayout.
   * This parity is asserted at runtime.
   */
  sizeofPerSlot: number
  /**
   * Columns in natural-alignment-sorted order (largest element size first).
   * Flattened across all nested struct levels.
   */
  columns: readonly ColumnDesc[]
  /**
   * Map from dotted column name → ColumnDesc, in declaration order.
   * Used by the handle codegen and (in task-3) by slab.column() lookups.
   */
  columnMap: Map<string, ColumnDesc>
  /**
   * Handle tree in declaration order. The codegen walks this tree to emit
   * nested handle classes that expose h.pos.x, h.vel.y, etc.
   */
  handleTree: HandleNode
}

/**
 * Recursively collect all leaf numeric fields from a struct field map,
 * returning them in declaration order with dotted path names.
 *
 * @param fields   The struct field map to flatten.
 * @param prefix   Dotted prefix accumulated from parent levels (empty at root).
 */
function flattenFields(
  fields: StructFields,
  prefix: string,
): Array<{ name: string; token: NumericType; elementSize: number; typedArrayCtor: TypedArrayCtor }> {
  const result: Array<{ name: string; token: NumericType; elementSize: number; typedArrayCtor: TypedArrayCtor }> = []

  for (const key of Object.keys(fields)) {
    const fieldType = fields[key]!
    const qualifiedName = prefix.length > 0 ? `${prefix}.${key}` : key

    if (isNumericType(fieldType)) {
      result.push({
        name: qualifiedName,
        token: fieldType as NumericType,
        elementSize: NUMERIC_SIZES[fieldType as NumericType],
        typedArrayCtor: TYPED_ARRAY_CTORS[fieldType as NumericType],
      })
    } else {
      // Nested StructDef — recurse into its fields.
      const nested = flattenFields(fieldType.fields, qualifiedName)
      result.push(...nested)
    }
  }

  return result
}

/**
 * Recursively build a HandleNode tree that mirrors the original declaration order.
 * This is the structure the codegen uses to know which fields belong at each level.
 *
 * @param fields     The struct field map at this level.
 * @param path       Dotted path from the root (empty string at root).
 * @param columnMap  The column map built during layout (keyed by dotted name).
 */
function buildHandleTree(
  fields: StructFields,
  path: string,
  columnMap: Map<string, ColumnDesc>,
): HandleNode {
  const numericFields: Array<{ name: string; column: ColumnDesc }> = []
  const nestedFields: Array<{ name: string; child: HandleNode }> = []

  for (const key of Object.keys(fields)) {
    const fieldType = fields[key]!
    const qualifiedName = path.length > 0 ? `${path}.${key}` : key

    if (isNumericType(fieldType)) {
      const column = columnMap.get(qualifiedName)
      if (column === undefined) {
        throw new Error(`buildHandleTree: column not found for '${qualifiedName}'`)
      }
      numericFields.push({ name: key, column })
    } else {
      // Nested StructDef — recurse.
      const child = buildHandleTree(fieldType.fields, qualifiedName, columnMap)
      nestedFields.push({ name: key, child })
    }
  }

  return { path, numericFields, nestedFields }
}

/**
 * Computes the SoA column layout for a set of struct fields.
 *
 * Steps:
 *  1. Flatten all leaf numeric fields (depth-first, preserving declaration order).
 *  2. Sort by element size descending for natural alignment, preserving declaration
 *     order within each size bucket (stable sort).
 *  3. Assign per-slot byte offsets: each column gets the running total of prior
 *     column element sizes. The descending-size sort guarantees each offset is a
 *     multiple of the column's element size.
 *  4. Build a declaration-order column map and handle tree.
 *  5. Assert runtime invariants: alignment, total-byte parity with computeLayout,
 *     and completeness (every field appears exactly once).
 *
 * Throws if fields is empty (delegated to computeLayout).
 */
export function computeColumnLayout(fields: StructFields): ColumnLayout {
  // Step 1: flatten all leaf fields in declaration order.
  const flat = flattenFields(fields, '')

  if (flat.length === 0) {
    throw new Error('computeColumnLayout: fields must not be empty — a struct requires at least one field')
  }

  // Step 2: stable sort by element size descending.
  // JavaScript's Array.prototype.sort() is stable in all modern engines (ES2019+),
  // so declaration order within each bucket is preserved automatically.
  const sorted = [...flat].sort((a, b) => b.elementSize - a.elementSize)

  // Step 3: assign per-slot byte offsets.
  // Because we sorted largest-first and all element sizes are powers of two, each
  // column's offset is automatically a multiple of its own element size:
  //   - f64 (8 bytes): first offsets are multiples of 8 ✓
  //   - f32/u32/i32 (4 bytes): start after all f64 columns; total f64 bytes is
  //     a multiple of 8 which is also a multiple of 4 ✓
  //   - u16/i16 (2 bytes): similarly aligned ✓
  //   - u8/i8 (1 byte): trivially aligned ✓
  const columns: ColumnDesc[] = []
  let byteOffset = 0

  for (const field of sorted) {
    columns.push({
      name: field.name,
      token: field.token,
      elementSize: field.elementSize,
      typedArrayCtor: field.typedArrayCtor,
      byteOffset,
      byteLength: 0,
    })
    byteOffset += field.elementSize
  }

  const sizeofPerSlot = byteOffset

  // Step 4: build the declaration-order column map and handle tree.
  // columnMap is keyed by dotted name so slab and codegen can look up columns by name.
  const columnMap = new Map<string, ColumnDesc>()
  for (const col of columns) {
    columnMap.set(col.name, col)
  }

  const handleTree = buildHandleTree(fields, '', columnMap)

  // Step 5: runtime invariant assertions.
  // (a) Alignment: every column's byteOffset must be a multiple of its elementSize.
  for (const col of columns) {
    if (col.byteOffset % col.elementSize !== 0) {
      throw new Error(
        `computeColumnLayout: alignment violation — column '${col.name}' has byteOffset ${col.byteOffset} which is not a multiple of elementSize ${col.elementSize}`,
      )
    }
  }

  // (b) Parity with the old AoS layout's sizeof.
  const oldSizeof = computeLayout(fields).sizeof
  if (sizeofPerSlot !== oldSizeof) {
    throw new Error(
      `computeColumnLayout: sizeof parity violation — SoA sizeofPerSlot ${sizeofPerSlot} !== AoS sizeof ${oldSizeof}`,
    )
  }

  // (c) Completeness: every leaf from flattenFields appears exactly once in columns.
  //     Already guaranteed by the algorithm (flat → sort → columns), but assert for safety.
  if (columns.length !== flat.length) {
    throw new Error(
      `computeColumnLayout: completeness violation — ${columns.length} columns vs ${flat.length} leaf fields`,
    )
  }

  return { sizeofPerSlot, columns, columnMap, handleTree }
}
