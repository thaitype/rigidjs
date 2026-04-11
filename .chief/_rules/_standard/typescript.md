# TypeScript Standard

## Compiler

- Strict mode is always on. Do not weaken `tsconfig.json`.
- ESM only (`"type": "module"`). No CommonJS.
- Target ESNext. Bun is the only supported runtime — assume all modern JS features.

## Style

- **No `any` in public API.** Internal `any` is tolerated only when interop with `DataView` / generated code requires it, and must be isolated in one file with a comment explaining why.
- **No `unknown` leaking to users.** Cast at the boundary with a type guard.
- **Named exports only** from `src/index.ts`. No default exports in library code.
- **Explicit return types on exported functions.** Inferred is fine for internal helpers.
- **Generics over overloads** where possible. Propagate struct field types to handle accessors so field reads/writes are typed end-to-end.

## Example — required typing for public API

```ts
// ✅ Field types flow through to the handle
export function struct<F extends StructFields>(fields: F): StructDef<F>

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
// typeof Vec3.handle.x === number  (inferred from 'f64')
```

```ts
// ❌ Never ship this
export function struct(fields: any): any
```

## Errors

- Throw `Error` subclasses with clear messages. Do not return error codes or null sentinels from public API.
- Validate at public API boundaries only. Internal helpers trust their callers.
- Use-after-`drop()` must throw, not silently no-op.

## Files

- One primary export per file. Helpers may live alongside.
- File names use kebab-case: `struct.ts`, `handle-codegen.ts`.
- Tests live in `tests/<feature>.test.ts`, mirroring `src/<feature>.ts`.
