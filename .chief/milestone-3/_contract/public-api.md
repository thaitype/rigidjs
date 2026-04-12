# Milestone 3 Public API Contract

Strict extension of `.chief/milestone-2/_contract/public-api.md`. Every symbol from milestone-1 and milestone-2 remains exported with **identical signatures and identical semantics**. Milestone-3 adds exactly one method to the `Slab<F>` interface plus two type helpers. Nothing is renamed, removed, or reshaped.

## Exported Symbols (cumulative)

```ts
// from 'rigidjs'
export { struct, slab }
export type {
  StructDef,
  StructFields,
  NumericType,
  Slab,
  Handle,
  // --- milestone-3 additions ---
  ColumnKey,
  ColumnType,
}
```

## Unchanged from Milestone-2

Every symbol documented in `.chief/milestone-2/_contract/public-api.md` keeps its exact signature, JSDoc semantics, and error behaviour:

- `struct(fields)` — unchanged. `StructDef.sizeof` unchanged. `StructDef.fields` unchanged. Observable layout rules (declaration order, no padding, nested inline, dotted nested access) unchanged.
- `slab(def, capacity)` — unchanged constructor signature.
- `Slab<F>.insert()` / `remove(slot)` / `get(slot)` / `has(slot)` / `len` / `capacity` / `clear()` / `drop()` — unchanged signatures, unchanged throw behaviour, unchanged semantics.
- **`Slab<F>.buffer`** — unchanged. Still returns a single `ArrayBuffer`. Internally, the slab now lays out column sub-views into that single buffer — the buffer identity and the "one `ArrayBuffer` per slab" rule are preserved.
- `Handle<F>` — unchanged observable shape. `handle.slot` getter unchanged. Nested handle access (`h.pos.x`) unchanged. Handle reuse contract unchanged (same instance across `insert()` / `get()` calls).

Internal implementation details (the internal handle field names, the codegen strategy, whether accessors use DataView or TypedArray) are **not** part of the contract and may change. Milestone-3 changes them.

## New in Milestone-3

### `Slab<F>.column(name)` — additive method

```ts
export interface Slab<F extends StructFields> {
  // ...all existing members unchanged...

  /**
   * Return the underlying TypedArray view for the named column.
   *
   * The name space is the flattened dotted-key space: for a struct with
   * nested fields, top-level and nested fields both appear as dotted keys.
   * For example, given:
   *
   *   const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
   *   const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })
   *   const particles = slab(Particle, 100_000)
   *
   * the valid column names are:
   *
   *   'pos.x' | 'pos.y' | 'pos.z' | 'vel.x' | 'vel.y' | 'vel.z' | 'life' | 'id'
   *
   * The returned TypedArray is a direct view into the slab's single
   * ArrayBuffer. Mutations to the TypedArray are reflected via Handle
   * field access and vice versa:
   *
   *   const xs = particles.column('pos.x')  // Float64Array
   *   xs[5] = 42
   *   particles.get(5).pos.x === 42         // true
   *
   * The view is pre-built at slab construction — calling `column()`
   * is allocation-free on every call.
   *
   * Do NOT store the returned reference past a `.drop()` call: the
   * underlying ArrayBuffer is released on drop and subsequent access
   * on the TypedArray is undefined behaviour.
   *
   * @throws "slab has been dropped" after drop().
   * @throws "unknown column: <name>" if the name is not a valid
   *         flattened column key for this struct.
   */
  column<K extends ColumnKey<F>>(name: K): ColumnType<F, K>
}
```

### `ColumnKey<F>` — type helper

```ts
/**
 * Flattened dotted-key union type for all columns in a struct.
 * Top-level numeric fields contribute their own name.
 * Nested StructDef fields contribute `'<outer>.<inner>'` recursively.
 */
export type ColumnKey<F extends StructFields> = /* see impl */
```

Worked example:

```ts
type V3 = { x: 'f64'; y: 'f64'; z: 'f64' }
type P  = { pos: StructDef<V3>; vel: StructDef<V3>; life: 'f32'; id: 'u32' }
// ColumnKey<P> === 'pos.x' | 'pos.y' | 'pos.z'
//                | 'vel.x' | 'vel.y' | 'vel.z'
//                | 'life'  | 'id'
```

### `ColumnType<F, K>` — type helper

```ts
/**
 * Given a struct field map F and a flattened column key K,
 * resolves to the concrete TypedArray subclass backing that column.
 *
 *   'f64' → Float64Array
 *   'f32' → Float32Array
 *   'u32' → Uint32Array
 *   'u16' → Uint16Array
 *   'u8'  → Uint8Array
 *   'i32' → Int32Array
 *   'i16' → Int16Array
 *   'i8'  → Int8Array
 */
export type ColumnType<F extends StructFields, K extends ColumnKey<F>> = /* see impl */
```

Worked example:

```ts
const particles = slab(Particle, 100_000)
const xs:  Float64Array = particles.column('pos.x')   // type-checked
const ids: Uint32Array  = particles.column('id')      // type-checked
// particles.column('nope') — ❌ TS error, not a valid ColumnKey<Particle>
```

## Semantics of `column()`

- **Allocation-free.** The TypedArray view is built once during `slab()` construction and stored internally. Every `column(name)` call returns the same pre-built reference.
- **Same-buffer guarantee.** `particles.column('pos.x').buffer === particles.buffer` holds for every valid column name (the returned view is a sub-view into the slab's single underlying `ArrayBuffer`).
- **Length.** The returned TypedArray's `length` equals `slab.capacity` — it spans every potential slot, occupied or not. Use `slab.has(i)` to check occupancy before reading. This matches the design where a column is a dense vector indexed by slot.
- **Index identity.** For any valid slot `i` and column `K`, `slab.column(K)[i]` and the handle accessor path (`slab.get(i).<K>`) read and write the same memory cell.
- **Mutation safety.** Writing to a column TypedArray mutates the underlying buffer in place — the same mutation is observable through handle accessors and vice versa. No copy-on-write, no diffing.
- **Drop behaviour.** After `slab.drop()`, calling `column(name)` throws `"slab has been dropped"`. Any previously returned TypedArray reference should not be used — reads/writes after drop are undefined behaviour.

## Layout Rules (observable)

Observable layout semantics from the milestone-2 contract are preserved:

- `StructDef.sizeof` = sum of field sizes in declaration order. Unchanged.
- `Handle<F>` accessors for nested fields still work as `h.pos.x`. Unchanged.
- Fields are laid out "in declaration order with no padding" **as observed by any public API**: `sizeof`, field access, and nested access all behave identically to milestone-2.

Internally, the slab's column layout applies a natural-alignment sort so each column's TypedArray sub-view starts at a well-aligned byte offset. This reorder is **not observable** through any public API. `slab.buffer` is still a single `ArrayBuffer`; no public method exposes per-column byte offsets.

## Stability

All symbols listed in this file are append-only within milestone-3. Renaming or removing any milestone-2 symbol, or changing the `column()` signature, requires a chief-agent-driven contract amendment.

## Not Yet Exported (Still)

`vec`, `bump`, `.iter()`, `for..of`, string types, `.insert({...})` object form — deferred to future milestones.
