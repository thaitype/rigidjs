/**
 * Numeric type tokens for struct field types (Phase 1).
 * Order matches the public contract in _rules/_contract/public-api.md.
 */
export type NumericType = 'f64' | 'f32' | 'u32' | 'u16' | 'u8' | 'i32' | 'i16' | 'i8'

/**
 * Recursive map of field names to numeric tokens or nested StructDefs.
 * Interface form is required so the self-reference resolves cleanly.
 */
export interface StructFields {
  readonly [key: string]: NumericType | StructDef<StructFields>
}

/** Kept for backwards compatibility of existing internal imports. */
export type FieldType = NumericType | StructDef<StructFields>

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
  readonly _Handle?: new (view: DataView, baseOffset: number, slot: number) => object
  /** @internal Offset table — implementation detail. */
  readonly _offsets?: ReadonlyMap<string, { offset: number; type: FieldType }>
}

/**
 * Maps a single field type to its runtime JS value.
 *  - Numeric tokens → number
 *  - Nested StructDef<G> → Handle<G>
 */
type FieldValue<T> =
  T extends NumericType ? number :
  T extends StructDef<infer G> ? Handle<G> :
  never

/**
 * Public structural type of a struct handle.
 *
 * Every field in F becomes a writable accessor of the appropriate JS type.
 * `slot` is the read-only slot index the handle currently points to
 * (for nested handles it is always 0 and has no meaning — do not rely on it).
 */
export type Handle<F extends StructFields> =
  { readonly slot: number }
  & { -readonly [K in keyof F]: FieldValue<F[K]> }

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
