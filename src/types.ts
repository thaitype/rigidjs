/**
 * Numeric type tokens for struct field types (Phase 1).
 * Order matches the public contract in _rules/_contract/public-api.md.
 */
export type NumericType = 'f64' | 'f32' | 'u32' | 'u16' | 'u8' | 'i32' | 'i16' | 'i8'

/**
 * FieldType is either a numeric type token or a nested StructDef.
 * The `StructDef<any>` here is intentional: FieldType must accept any
 * StructDef regardless of its specific field shape (recursive type).
 */
export type FieldType = NumericType | StructDef<any> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A map of field names to their types.
 */
export type StructFields = Record<string, FieldType>

/**
 * A struct blueprint. Carries sizeof and the original field map.
 *
 * `_Handle` and `_offsets` are internal-only implementation details.
 * They are NOT part of the public contract and may change without notice.
 * Prefixed with underscore and marked as optional so they do not appear
 * in public type signatures while still being accessible internally.
 */
export interface StructDef<F extends StructFields> {
  readonly sizeof: number
  readonly fields: F
  /** @internal Generated handle constructor — implementation detail. */
  readonly _Handle?: new (view: DataView, baseOffset: number) => object
  /** @internal Offset table — implementation detail. */
  readonly _offsets?: ReadonlyMap<string, { offset: number; type: FieldType }>
}

/**
 * Byte sizes for each numeric type.
 * Single source of truth — never inline the number 8 (or any other size) elsewhere.
 * Internal: not re-exported from src/index.ts.
 */
export const NUMERIC_SIZES: Record<NumericType, number> = {
  f64: 8,
  f32: 4,
  u32: 4,
  u16: 2,
  u8:  1,
  i32: 4,
  i16: 2,
  i8:  1,
}
