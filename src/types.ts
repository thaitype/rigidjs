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
 *
 * NOTE (milestone-3): `_Handle` is now the SoA handle constructor (slot: number) => object.
 * The AoS constructor signature (view: DataView, baseOffset: number, slot: number) has been removed.
 * `_offsets` is preserved for tests that read Particle._offsets (public-api.test.ts).
 */
export interface StructDef<F extends StructFields> {
  readonly sizeof: number
  readonly fields: F
  /** @internal Generated SoA handle constructor — implementation detail. (slot: number) */
  readonly _Handle?: new (slot: number) => object
  /** @internal Offset table — implementation detail. Preserved for milestone-1 test compatibility. */
  readonly _offsets?: ReadonlyMap<string, { offset: number; type: FieldType }>
  /** @internal Column layout — implementation detail for SoA containers. */
  readonly _columnLayout?: import('./struct/layout.js').ColumnLayout
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

// ---------------------------------------------------------------------------
// SoA column type helpers (milestone-3)
// ---------------------------------------------------------------------------

/**
 * Internal helper: maps a NumericType token to its concrete TypedArray subclass type.
 * Not exported — used internally by ColumnType<F, K>.
 */
type TypedArrayFor<T extends NumericType> =
  T extends 'f64' ? Float64Array :
  T extends 'f32' ? Float32Array :
  T extends 'u32' ? Uint32Array :
  T extends 'u16' ? Uint16Array :
  T extends 'u8'  ? Uint8Array :
  T extends 'i32' ? Int32Array :
  T extends 'i16' ? Int16Array :
  T extends 'i8'  ? Int8Array :
  never

/**
 * Internal helper: given a struct field map F and a dotted key string K,
 * resolves to the NumericType of the leaf field. Walks one level of nesting
 * for keys of the form `'outer.inner'`.
 * Not exported — used internally by ColumnType<F, K>.
 */
type ResolveLeafToken<F extends StructFields, K extends string> =
  K extends `${infer Head}.${infer Tail}`
    ? Head extends keyof F
      ? F[Head] extends StructDef<infer G>
        ? ResolveLeafToken<G, Tail>
        : never
      : never
    : K extends keyof F
      ? F[K] extends NumericType
        ? F[K]
        : never
      : never

/**
 * Flattened dotted-key union of all columns reachable from a struct field map.
 * Top-level numeric fields contribute their own key.
 * Nested StructDef fields contribute `'<outer>.<inner>'` for every reachable
 * leaf in the nested struct, recursively.
 *
 * Example:
 *   type V3 = { x: 'f64'; y: 'f64'; z: 'f64' }
 *   type P  = { pos: StructDef<V3>; vel: StructDef<V3>; life: 'f32'; id: 'u32' }
 *   // ColumnKey<P> === 'pos.x' | 'pos.y' | 'pos.z' | 'vel.x' | 'vel.y' | 'vel.z' | 'life' | 'id'
 */
export type ColumnKey<F extends StructFields> = {
  [K in keyof F & string]:
    F[K] extends NumericType
      ? K
      : F[K] extends StructDef<infer G>
        ? `${K}.${ColumnKey<G> & string}`
        : never
}[keyof F & string]

/**
 * Given a struct field map F and a flattened column key K, resolves to the
 * concrete TypedArray subclass that backs that column.
 *
 *   'f64' → Float64Array
 *   'f32' → Float32Array
 *   'u32' → Uint32Array
 *   'u16' → Uint16Array
 *   'u8'  → Uint8Array
 *   'i32' → Int32Array
 *   'i16' → Int16Array
 *   'i8'  → Int8Array
 *
 * Example:
 *   ColumnType<P, 'pos.x'>  → Float64Array
 *   ColumnType<P, 'life'>   → Float32Array
 *   ColumnType<P, 'id'>     → Uint32Array
 */
export type ColumnType<
  F extends StructFields,
  K extends ColumnKey<F>,
> = TypedArrayFor<ResolveLeafToken<F, K> & NumericType>
