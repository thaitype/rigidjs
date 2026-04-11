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

## `slab(def, capacity)` — Phase 1b

```ts
export function slab<F>(def: StructDef<F>, capacity: number): Slab<F>
```

Not in milestone-1 scope. Listed for forward reference only. See spec §4.2 for full API.

## `vec(def, capacity)` — Phase 1c

Not in milestone-1 scope. See spec §4.3.

## `bump(def, capacity)` / `bump.scoped(...)` — Phase 1d

Not in milestone-1 scope. See spec §4.4.

## Iteration & `.drop()` — Phase 1e / 1f

Not in milestone-1 scope. See spec §4.5 / §4.6.

## Stability

- Any symbol listed in this file is append-only within a milestone. Renaming or removing requires a contract change proposed by chief-agent.
- Internal implementation details (e.g., the name of the generated handle class, DataView instance field name) are **not** part of the contract and may change freely.
