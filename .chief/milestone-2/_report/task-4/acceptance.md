# Milestone-2 Acceptance Report

Generated: 2026-04-11
Task: milestone-2 / task-4

---

## `bun test` Summary

```
bun test v1.3.8 (b64edcb4)
 134 pass
 0 fail
 250 expect() calls
Ran 134 tests across 8 files. [86.00ms]
```

## `bun run typecheck` Summary

```
$ tsc --noEmit
(no output — exit 0)
```

## `bun run examples/particles.ts` Output

```
capacity: 1024
len (after removal): 252
alive count (manual): 252
sum pos.x (alive): 616.928645
```

---

## Success Criteria Mapping

### 1. `bun test` passes with all milestone-1 tests still green plus full milestone-2 coverage

Evidence: 134 pass, 0 fail. All 125 milestone-1 tests confirmed still green (125 tests were green before task-4 started; all 8 test files pass). New milestone-2 tests added by task-4 bring total to 134.

Test files:
- `tests/struct/layout.test.ts`
- `tests/struct/handle-flat.test.ts`
- `tests/struct/handle-nested.test.ts`
- `tests/struct/public-api.test.ts`
- `tests/struct/handle-slot.test.ts`
- `tests/slab/bitmap.test.ts`
- `tests/slab/slab.test.ts`
- `tests/public-api/milestone-2.test.ts` (new in task-4)

### 2. `bun run typecheck` passes

Evidence: `tsc --noEmit` exits 0 with zero output.

### 3. `slab` and `Slab` exported from `rigidjs`

Evidence:
- `src/index.ts` contains `export { slab } from './slab/slab.js'` and `export type { Slab, Handle } from './slab/slab.js'`
- Test `tests/public-api/milestone-2.test.ts` — "typeof slab === 'function'" — passes
- Test `tests/slab/slab.test.ts` — "public export > pkg.slab is a function" — passes (dynamic import confirms)

### 4. `Handle<F>` type is usable as a type annotation

Evidence:
- Test `tests/public-api/milestone-2.test.ts` — "Handle<F> is usable as a variable annotation" — passes
- `export type { Handle } from './slab/slab.js'` in `src/index.ts`
- `bun run typecheck` exits 0 with `Handle<F>` annotation in test file

### 5. No `Proxy` anywhere — grep confirms

Evidence:
```
grep -rn "Proxy" src/
(no output — exit 1)
```
Zero matches in `src/`.

### 6. No per-call JS object allocation in `insert`/`remove`/`get`/`has`

Evidence (code review of `src/slab/slab.ts`):
- `insert()`: no object literal, no array literal, no closure, no `new X()` — only `_freeList.pop()`, `bitmapSet()`, `_handle._rebase()`.
- `remove()`: no allocation — only `(handle as any)._slot`, `bitmapGet()`, `bitmapClear()`, `_freeList.push()`.
- `get()`: no allocation — only bounds check and `_handle._rebase()`.
- `has()`: no allocation — only `bitmapGet()`.
- `clear()`: wipes bitmap in-place (`_bits.fill(0)`) and rebuilds free-list in-place (mutates `_freeList.length`).

All closures (`assertLive`) and data structures (`_handle`, `_freeList`, `_bits`) are created once at `slab()` call time — not on hot paths.

Verdict: PASS — no per-call allocations in hot paths.

### 7. `examples/particles.ts` runs cleanly and prints expected output

Evidence:
```
bun run examples/particles.ts
capacity: 1024
len (after removal): 252
alive count (manual): 252
sum pos.x (alive): 616.928645
```
Exit code 0. Output deterministic and reproducible (no `Math.random()`; LCG seeded with constant 42).

### 8. `struct()` API (including `sizeof`, `fields`, behavior) is unchanged from milestone-1

Evidence: All 5 struct test files pass (layout, handle-flat, handle-nested, public-api, handle-slot). `struct()` signature is unchanged. No modifications to `src/struct/` in task-4.

### 9. Zero runtime dependencies still

Evidence:
```
package.json: { "dependencies": absent/empty }
```
Confirmed: `dependencies` key absent from `package.json`.

### 10. `src/index.ts` contains ONLY re-export statements

Evidence:
```
grep -n "function\|class\|const\|let" src/index.ts
(no output — exit 1)
```
Content of `src/index.ts`:
```ts
export { struct } from './struct/struct.js'
export { slab } from './slab/slab.js'
export type { StructDef, StructFields, NumericType } from './types.js'
export type { Slab, Handle } from './slab/slab.js'
```
Only `export { ... }` and `export type { ... }` statements. No logic.

### 11. Design spec `.chief/_rules/_goal/rigidjs-design-spec-v3.md` is unmodified

Evidence:
```
git status -- .chief/_rules/_goal/rigidjs-design-spec-v3.md
On branch main
nothing to commit, working tree clean
```

### 12. `.chief/milestone-2/_report/task-4/acceptance.md` exists and maps every success criterion to evidence

Evidence: This file.

### 13. `examples/particles.ts` output captured at `.chief/milestone-2/_report/task-4/particles-output.txt`

Evidence: File exists at `.chief/milestone-2/_report/task-4/particles-output.txt` with the captured stdout.

### 14. `src/internal/single-slot.ts` is NOT re-exported from `src/index.ts`

Evidence: `src/index.ts` only re-exports from `./struct/struct.js`, `./slab/slab.js`, and `./types.js`. No reference to `src/internal/`.

---

## Line Counts

| File | Lines |
|------|-------|
| `src/slab/slab.ts` | 209 |
| `src/slab/bitmap.ts` | 54 |
| `examples/particles.ts` | 171 |

---

## Zero-Runtime-Dependency Confirmation

`package.json` `dependencies` key is absent. All imports are JS built-ins or `bun:*` modules.

---

## Task-5 Amendment

Generated: 2026-04-11
Amendment: milestone-2 / task-5 (slot-key amendment)

### Contract Change Summary

- `Slab<F>.remove(slot: number)` — parameter changed from `handle: Handle<F>` to `slot: number`. Includes integer and range validation.
- `Slab<F>.has(slot: number)` — parameter changed from `handle: Handle<F>` to `slot: number`. Includes integer and range validation.
- `Handle<F>.slot` — new public read-only getter on the prototype (emitted by `handle-codegen.ts`). Returns same value as internal `_slot` raw property.
- Error messages: out-of-range throws `"slot X out of range"`; double-free throws `"slot X already free"`.

### `bun test` Output (post task-5)

```
bun test v1.3.8 (b64edcb4)
 154 pass
 0 fail
 285 expect() calls
Ran 154 tests across 8 files.
```

20 new tests added (slot-key validation, `handle.slot` getter, footgun-proof capture pattern). All prior 134 tests remain green.

### `bun run typecheck` Output (post task-5)

```
$ tsc --noEmit
(no output — exit 0)
```

### `bun run examples/particles.ts` Output (post task-5)

```
capacity: 1024
len (after removal): 252
alive count (manual): 252
sum pos.x (alive): 616.928645
```

Output is identical to task-4. The example was rewritten to use `has(i)` and `remove(i)` with numeric slots directly, and `get(i)` for field access — consistent with the new slot-key API.

### Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| `bun test` exits 0 — 154 tests pass | PASS |
| `bun run typecheck` exits 0 | PASS |
| `bun run examples/particles.ts` deterministic output, exits 0 | PASS |
| `grep -n "get slot()" src/struct/handle-codegen.ts` — at least one match | PASS (line 119) |
| `grep -rn "remove(handle" src/slab/slab.ts` — zero matches | PASS |
| `grep -rn "has(handle" src/slab/slab.ts` — zero matches | PASS |
| `grep -rn "Proxy" src/` — zero matches | PASS |
| `grep -n "new ArrayBuffer(" src/slab/slab.ts` — exactly one match | PASS (line 106) |
| `grep -n "new DataView(" src/slab/slab.ts` — exactly one match | PASS (line 107) |
| No new allocations in hot paths — code review | PASS |
| `handle.slot` getter is read-only (no setter emitted) | PASS — descriptor has `get`, no `set` |
| `remove(slotA)` after subsequent `insert()` removes originally captured slot | PASS — footgun-proof test in slab.test.ts |
| `examples/particles.ts` JSDoc mentions handle reuse + slot capture | PASS |
| Acceptance report updated with task-5 amendment section | PASS — this section |

### Milestone-2 Success Criteria (Still Hold Under New Signatures)

All milestone-2 success criteria from the original task-4 acceptance report continue to hold:
- All struct tests pass (unchanged from milestone-1)
- `slab` / `Slab` / `Handle` exported from `rigidjs`
- No `Proxy`, no per-call allocations in hot paths
- Exactly one `ArrayBuffer` + one `DataView` in `src/slab/slab.ts`
- Zero runtime dependencies
