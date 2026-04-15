# Task 4: Options API + SoA Mode Passthrough

**Status:** Not started
**Type:** Implementation
**Estimated effort:** 45-60 minutes
**Depends on:** Task 3

## Objective

Redesign the `vec()` function signature to accept an options object as the second argument, supporting all mode configurations. Fix backward compatibility for existing `vec(T, number)` call sites. Ensure existing SoA-only tests pass again.

## Scope

**In scope:**
- New `vec()` signature: `vec<F>(def: StructDef<F>, opts?: number | VecOptions): Vec<F>`
- `VecOptions` interface:
  ```typescript
  interface VecOptions {
    capacity?: number    // pre-allocate SoA capacity (implies mode: 'soa')
    mode?: 'js' | 'soa' // force a specific mode
    graduateAt?: number  // custom graduation threshold (default 128)
  }
  ```
- Behavior matrix:
  | Call | Mode | Graduation |
  |------|------|------------|
  | `vec(T)` | JS, graduates at 128 | auto |
  | `vec(T, 100)` | SoA immediately, capacity=100 | N/A (already SoA) |
  | `vec(T, { capacity: 100 })` | SoA immediately, capacity=100 | N/A |
  | `vec(T, { mode: 'soa' })` | SoA immediately, capacity=16 | N/A |
  | `vec(T, { mode: 'js' })` | JS permanently | never |
  | `vec(T, { graduateAt: 256 })` | JS, graduates at 256 | auto |
  | `vec(T, { mode: 'soa', capacity: 1000 })` | SoA, capacity=1000 | N/A |
  | `vec(T, { mode: 'js', graduateAt: 256 })` | JS permanently (graduateAt ignored) | never |
- Export `VecOptions` type from `src/index.ts`
- Fix all existing vec tests that pass `vec(T, number)` -- these should continue to work
- Validation:
  - `capacity` must be a positive integer
  - `graduateAt` must be a positive integer
  - `{ mode: 'js', capacity: N }` is an error (conflicting: capacity implies SoA)

**Out of scope:**
- New benchmark scenarios
- shrinkToFit
- Any behavioral changes beyond options routing

## Rules & Contracts

- `.chief/_rules/_verification/verification.md`
- `.chief/milestone-7/_goal/hybrid-vec-design-spec.md` -- Section 3 (API, Construction)
- Backward compatibility: `vec(T, number)` must continue to work (SoA mode, same as before)

## Steps

### 4a: Parse Options

At the top of `vec()`, normalize the second argument:

```typescript
function vec<F>(def: StructDef<F>, opts?: number | VecOptions): Vec<F> {
  let mode: 'js' | 'soa' | 'hybrid' = 'hybrid'  // hybrid = JS with auto-graduation
  let initialCapacity: number | undefined
  let graduateAt = 128

  if (typeof opts === 'number') {
    // Backward compat: vec(T, 16) → SoA mode, capacity=16
    mode = 'soa'
    initialCapacity = opts
  } else if (opts !== undefined) {
    if (opts.mode === 'soa' || opts.capacity !== undefined) {
      mode = 'soa'
      initialCapacity = opts.capacity
    } else if (opts.mode === 'js') {
      mode = 'js'  // permanent JS mode
    }
    if (opts.graduateAt !== undefined) {
      graduateAt = opts.graduateAt
    }
  }

  // Validation
  if (opts && typeof opts === 'object' && opts.mode === 'js' && opts.capacity !== undefined) {
    throw new Error('vec: cannot combine mode "js" with capacity (capacity implies SoA mode)')
  }

  // Route to JS or SoA initialization...
}
```

### 4b: Mode Routing

- If `mode === 'soa'`: initialize SoA immediately (existing path). Use `initialCapacity ?? DEFAULT_CAPACITY`.
- If `mode === 'js'`: initialize JS mode. Set `_graduateAt = Infinity` (never graduate).
- If `mode === 'hybrid'`: initialize JS mode. Set `_graduateAt = graduateAt`.

### 4c: Fix Existing Tests

The existing vec test files use `vec(T, capacity)` pattern. After this task, that call pattern routes to SoA mode immediately, which is the same behavior as before M7. All existing tests should pass without modification.

### 4d: New Tests

Create `tests/vec/vec-options.test.ts`:
- `vec(T)` starts in JS mode
- `vec(T, 16)` starts in SoA mode with capacity 16
- `vec(T, { capacity: 100 })` starts in SoA mode with capacity 100
- `vec(T, { mode: 'soa' })` starts in SoA mode
- `vec(T, { mode: 'js' })` starts in JS mode, never graduates even past threshold
- `vec(T, { graduateAt: 4 })` graduates at len 4
- `vec(T, { mode: 'js', capacity: N })` throws
- `vec(T, { graduateAt: 0 })` throws (must be positive integer)
- `vec(T, { capacity: -1 })` throws
- All existing vec tests pass unchanged

## Acceptance Criteria

- [ ] `bun test` passes with zero failures (ALL existing vec tests + new tests)
- [ ] `bun run typecheck` passes with zero errors
- [ ] `vec(T, number)` backward compatibility preserved
- [ ] All option combinations produce correct mode behavior
- [ ] `VecOptions` type exported from `src/index.ts`
- [ ] Invalid option combinations throw descriptive errors
- [ ] `{ mode: 'js' }` never graduates (even when len exceeds default threshold)
- [ ] `{ graduateAt: N }` customizes the threshold

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- Modified `src/vec/vec.ts` -- options parsing, mode routing
- Modified `src/index.ts` -- export `VecOptions`
- `tests/vec/vec-options.test.ts`
- All existing vec tests pass
