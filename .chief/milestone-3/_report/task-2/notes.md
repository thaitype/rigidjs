# Task-2 Implementation Notes

## Summary

Task-2 shipped the complete internal SoA + monomorphic TypedArray codegen infrastructure alongside the existing AoS + DataView path. Three source files were modified (`src/types.ts`, `src/struct/layout.ts`, `src/struct/handle-codegen.ts`) and one was extended (`src/index.ts` — type-only exports). Three new test files were added (`column-layout.test.ts`, `column-types.test.ts`, `soa-codegen.test.ts`). The slab still uses the old path unchanged. All 155 prior tests continue to pass; total test count is now 230.

## Natural-Alignment Sort Algorithm

`computeColumnLayout` flattens all leaf numeric fields depth-first (preserving declaration order), then applies a stable descending sort on `elementSize`. The resulting column order is: all `f64` (8 bytes), then all `f32`/`u32`/`i32` (4 bytes), then `u16`/`i16` (2 bytes), then `u8`/`i8` (1 byte). Byte offsets are assigned sequentially across this sorted list, starting from 0. Because JavaScript's `Array.prototype.sort` is stable (ES2019), declaration order is preserved within each size bucket.

Why this guarantees alignment: all TypedArray element sizes are powers of two (1, 2, 4, 8). The running offset before any f32/u32/i32 column is the sum of all f64 element sizes — always a multiple of 8, which is also a multiple of 4. Similarly, the running offset before any u16/i16 column is a multiple of 4, hence also a multiple of 2. Result: every `byteOffset % elementSize === 0` without any explicit padding.

## Dotted-Key Sanitization Rule

Column names are dotted paths (`pos.x`, `vel.z`, etc.). These are not valid JS identifiers. The codegen replaces `.` with `_` to derive instance field names: `pos.x` → `_c_pos_x`, `vel.z` → `_c_vel_z`, `life` → `_c_life`. The prefix `_c_` avoids collisions with user-facing field names and sub-handle names (`_sub_pos`).

## Why sizeofPerSlot === old sizeof

The SoA column sort is a permutation of the same leaf fields present in the AoS layout. Each field's element size is unchanged. Sorting does not add or remove fields; it only reorders them. Therefore, the sum of element sizes is invariant under sorting: `sizeofPerSlot = Σ elementSizes = AoS sizeof`.

This invariant is asserted at runtime inside `computeColumnLayout` (belt-and-braces; can be removed in a future cleanup milestone).

## SoA Factory Location

The SoA handle factory (`generateSoAHandleClass`) lives as a pure exported function in `src/struct/handle-codegen.ts`, alongside the unchanged `generateHandleClass`. No new field was added to `StructDef`. Task-3 will call `computeColumnLayout` and `generateSoAHandleClass` directly from `slab.ts` without needing a `_SoAHandleFactory` on `StructDef`. This keeps the surface area minimal and the task-3 diff clean.

`ColumnKey<F>` and `ColumnType<F, K>` are exported as type-only symbols from `src/types.ts` and re-exported (type-only) from `src/index.ts` immediately in task-2, so the public surface is complete before task-3 wires the runtime `slab.column()` method.

## Tests Added

- `tests/struct/column-layout.test.ts` — 28 tests covering: column count, sizeofPerSlot values, natural-alignment sort order (f64 before f32), byteOffset alignment invariants, dotted-key presence in columnMap, completeness (every leaf appears once), sizeof parity with `computeLayout` for three fixtures, and handleTree structure.
- `tests/struct/column-types.test.ts` — 19 tests with compile-time type assertions: `ColumnKey<P>` accepts all 8 valid dotted keys, rejects invalid names (`@ts-expect-error`), rejects bare nested-field names; `ColumnType<P, K>` resolves each of the 8 numeric types to the correct TypedArray subclass.
- `tests/struct/soa-codegen.test.ts` — 28 tests covering end-to-end handle instantiation, field write/read round-trip (including f32 precision), byte-layout verification via raw DataView, `_rebase` across multiple slots, sub-handle identity preservation, independence between two handle instances, and a flat struct (no nested fields) smoke test.

## Tests Modified

Zero. All 155 prior tests pass without modification because the slab is untouched.
