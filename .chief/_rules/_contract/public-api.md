# Public API Contract (Global)

The canonical public surface of `rigidjs`. Milestone contracts are strict subsets of this file.

**Package name:** `rigidjs`
**Entry:** `src/index.ts`
**Import style:** named imports only.

```ts
import { struct, slab, vec, bump } from 'rigidjs'
```

## Numeric Type Tokens (Phase 1)

String literal tokens identify primitive field types. These names are load-bearing — do not alias or rename.

| Token  | Bytes | DataView method                     | JS type  |
|--------|-------|-------------------------------------|----------|
| `'f64'`| 8     | `getFloat64` / `setFloat64`         | `number` |
| `'f32'`| 4     | `getFloat32` / `setFloat32`         | `number` |
| `'u32'`| 4     | `getUint32`  / `setUint32`          | `number` |
| `'u16'`| 2     | `getUint16`  / `setUint16`          | `number` |
| `'u8'` | 1     | `getUint8`   / `setUint8`           | `number` |
| `'i32'`| 4     | `getInt32`   / `setInt32`           | `number` |
| `'i16'`| 2     | `getInt16`   / `setInt16`           | `number` |
| `'i8'` | 1     | `getInt8`    / `setInt8`            | `number` |

Endianness: **little-endian** on all platforms. DataView calls must pass `true` for the `littleEndian` argument.

## `struct(fields)`

```ts
export function struct<F extends StructFields>(fields: F): StructDef<F>
```

- `fields` — an object literal whose values are either a numeric type token or another `StructDef`.
- Returns a `StructDef` — a blueprint. **No `ArrayBuffer` is allocated.**
- `StructDef` exposes:
  - `sizeof: number` — total bytes.
  - `fields: F` — the original field map (read-only).
  - Internally: an offset table and a generated handle class constructor. These are implementation details, not part of the public contract.

### Layout rules

- Fields are laid out in **declaration order**.
- **No padding.** Offset of field N = sum of sizes of fields 0..N-1.
- **Nested struct = inline.** Embedding `StructDef<X>` adds `sizeof(X)` bytes at that offset.
- Field access paths for nested structs use dotted access on handles: `p.pos.x`, not `p['pos.x']`.

## `slab(def, capacity)` — Phase 1b (shipped in milestone-2)

```ts
export function slab<F extends StructFields>(
  def: StructDef<F>,
  capacity: number,
): Slab<F>

export interface Slab<F extends StructFields> {
  insert(): Handle<F>
  remove(slot: number): void
  get(slot: number): Handle<F>
  has(slot: number): boolean
  readonly len: number
  readonly capacity: number
  clear(): void
  drop(): void
  readonly buffer: ArrayBuffer
}
```

### Slot key semantics

- A **slot** is a non-negative integer index into the slab, in `[0, capacity)`.
- `insert()` returns a shared `Handle<F>` already rebased to the new slot. The handle's `slot` getter exposes the numeric index.
- `remove(slot)`, `get(slot)`, and `has(slot)` all take the numeric slot — not a handle. This matches the Rust `slab` crate and keeps these calls allocation-free while avoiding stale-reference footguns.
- To hold a reference for later removal, capture the number: `const slotA = slab.insert().slot`.

### Handle shape (observable)

Every struct handle carries one public read-only member in addition to its generated field accessors:

```ts
interface HandleBase {
  readonly slot: number  // stable slot index (0 for handles not attached to a container)
}
```

For handles produced by `slab()`, `slot` is the index of the slot the handle currently points to. For handles obtained via internal test helpers (e.g., `createSingleSlot`), `slot` is `0`.

`slot` is a read-only getter — never assign to it from user code.

## `vec(def, capacity)` — Phase 1c

Not yet shipped. See spec §4.3.

## `vec(def, capacity)` — Phase 1c

Not in milestone-1 scope. See spec §4.3.

## `bump(def, capacity)` / `bump.scoped(...)` — Phase 1d

Not in milestone-1 scope. See spec §4.4.

## Iteration & `.drop()` — Phase 1e / 1f

Not in milestone-1 scope. See spec §4.5 / §4.6.

## Stability

- Any symbol listed in this file is append-only within a milestone. Renaming or removing requires a contract change proposed by chief-agent.
- Internal implementation details (e.g., the name of the generated handle class, DataView instance field name) are **not** part of the contract and may change freely.
