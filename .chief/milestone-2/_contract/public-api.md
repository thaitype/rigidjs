# Milestone 2 Public API Contract

Strict extension of `.chief/_rules/_contract/public-api.md`. Everything from milestone-1 remains exported; milestone-2 adds `slab` + its types.

## Exported Symbols (cumulative)

```ts
// from 'rigidjs'
export { struct, slab }
export type { StructDef, StructFields, NumericType, Slab, Handle }
```

## New Types

```ts
/** A reusable accessor into a struct's backing buffer. */
export type Handle<F extends StructFields> = /* generated class instance */

/** Fixed-capacity, slot-reusing container. */
export interface Slab<F extends StructFields> {
  /**
   * Fill the next free slot and return a reusable handle at that slot.
   * The returned handle is the SAME object across calls — do not hold
   * references past the next insert/get/remove call without copying.
   *
   * @throws if the slab is full or has been dropped.
   */
  insert(): Handle<F>

  /**
   * Free the slot the given handle currently refers to.
   *
   * @throws on double-free or if the slab has been dropped.
   */
  remove(handle: Handle<F>): void

  /**
   * Rebase the shared handle to slot `index`. Does NOT check occupancy —
   * callers should use `has()` if they need to verify.
   *
   * @throws if index is out of range or the slab has been dropped.
   */
  get(index: number): Handle<F>

  /** True if the slot the handle refers to is currently occupied. */
  has(handle: Handle<F>): boolean

  /** Number of occupied slots. */
  readonly len: number

  /** Maximum number of slots. */
  readonly capacity: number

  /** Mark every slot free. Keeps the underlying buffer. */
  clear(): void

  /** Release the underlying buffer. All subsequent calls throw. */
  drop(): void

  /** Underlying ArrayBuffer — escape hatch. Read-only reference. */
  readonly buffer: ArrayBuffer
}
```

## New Functions

```ts
export function slab<F extends StructFields>(
  def: StructDef<F>,
  capacity: number,
): Slab<F>
```

### Semantics

- Allocates exactly one `ArrayBuffer` of `def.sizeof * capacity` bytes.
- `capacity` must be a positive integer. Throws otherwise.
- Insertion order: first `insert()` on a fresh slab fills slot 0, then slot 1, etc.
- After a `remove(h)`, the freed slot is the next slot returned by `insert()` (LIFO recycling via the free-list).
- `insert()` returning a handle and then calling `insert()` again **invalidates the previous handle's slot binding** — the same handle instance is rebased. Users who need stable references must read field values out into JS primitives.

## Handle Reuse Contract (Observable)

1. `slab.insert()` and `slab.get(i)` both return the same handle instance (reference equality).
2. The handle carries an internal slot index (implementation detail — not a public property).
3. Reading/writing a field on the handle affects the slot it was last rebased to. Prior slots are untouched.

## Unchanged from Milestone-1

- `struct`, `StructDef`, `StructFields`, `NumericType` — no signature or semantic changes allowed.
- Little-endian layout, no padding, declaration-order fields.
- `new Function()`-based handle codegen stays the only handle mechanism.

## Not Yet Exported (Still)

`vec`, `bump`, `.iter()`, `for..of`, string types, `.insert({...})` object form — deferred.

## Stability

All symbols listed here are frozen for the rest of milestone-2. Signature changes require a chief-agent-driven contract amendment.
