# Repository Layout Standard

```
rigidjs/
├── src/
│   ├── index.ts              # public API — re-exports only
│   ├── types.ts              # shared public types (StructFields, NumericType, etc.)
│   ├── struct/               # struct() implementation
│   │   ├── struct.ts
│   │   ├── layout.ts         # offset/sizeof computation
│   │   └── handle-codegen.ts # new Function() handle class generator
│   └── internal/             # private helpers (not re-exported)
├── tests/
│   └── struct/               # mirrors src/struct/
├── examples/                 # runnable .ts examples
├── .chief/                   # framework state
├── package.json
└── tsconfig.json
```

## Rules

- `src/index.ts` contains **only** `export { ... } from './...'` statements. No logic.
- Private code under `src/internal/` must not be re-exported from `src/index.ts`.
- Tests mirror the `src/` tree. One test file per source file minimum.
- New top-level directories under `src/` require chief-agent approval (one per Phase 1 sub-feature: `struct/`, `slab/`, `vec/`, `bump/`, `iter/`).
- Do not create `src/utils/` or `src/lib/` grab-bag folders. Feature-scoped helpers live next to the feature.
