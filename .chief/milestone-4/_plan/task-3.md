# Task 3 -- for..of Iterator + Public API Wiring

## Objective

Add `Symbol.iterator` to vec for native `for..of` support, re-export `vec` and `Vec` from `src/index.ts` to complete the public API surface, and add a vec usage example under `examples/`. After this task, vec is fully usable from the public API with all operations including iteration.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_goal/goal.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-4/_contract/public-api.md` -- for..of semantics, handle reuse invariant
7. Current source:
   - `/Users/thada/gits/thaitype/rigidjs/src/vec/vec.ts` -- task-2 output (the file to edit)
   - `/Users/thada/gits/thaitype/rigidjs/src/index.ts` -- add re-exports here
   - `/Users/thada/gits/thaitype/rigidjs/examples/particles.ts` -- existing slab example (reference for format, do NOT modify)

## Scope Guardrails

- **Edits to:** `src/vec/vec.ts`, `src/index.ts` (add re-exports only), new test files under `tests/vec/`, new example file under `examples/`.
- **Do NOT edit** `src/slab/**`, `src/struct/**`, `src/types.ts`, `benchmark/**`, `CLAUDE.md`, `.chief/_rules/**`, `package.json`, `tsconfig.json`.
- **Do NOT edit** `examples/particles.ts` -- it stays as the slab reference example.
- **No new runtime dependencies.**
- **No `/tmp` scripts.**

## Deliverables

### 1. `Symbol.iterator` on vec

Add `[Symbol.iterator](): Iterator<Handle<F>>` to the vec implementation.

The iterator must:

1. Allocate one iterator object per `for..of` call. This is the only allocation.
2. On each `next()` call: if cursor < vec.len, rebase the shared handle to cursor, increment cursor, return `{ value: handle, done: false }`. Otherwise return `{ done: true, value: undefined }`.
3. Reuse the same handle instance across all iterations (zero allocation per next() call).
4. The `{ value, done }` result object: builder decides whether to reuse a single result object or create a new one per next() call. Creating one per call is standard Iterator protocol behavior and is the safe default. If builder can prove reuse is safe and beneficial, document why.

Builder decides between:
- **Generator function:** `*[Symbol.iterator]() { for (let i = 0; i < this._len; i++) { /* rebase */ yield handle } }`. Simple but allocates a generator object.
- **Custom iterator object:** class with next() method. More explicit control.

Either approach is acceptable. Pick the simpler one.

### 2. `src/index.ts` -- re-export vec and Vec

Add to the existing exports in `src/index.ts`:

```ts
export { vec } from './vec/vec.js'
export type { Vec } from './vec/vec.js'
```

The `Vec<F>` type must be exported so users can annotate variables. Verify the type is properly defined (either as an `interface` or `type` in `src/vec/vec.ts`).

### 3. `examples/vec-demo.ts` -- vec usage example

Create a new example file (do NOT modify `examples/particles.ts`). The example should demonstrate:

- Creating a vec with a struct definition.
- push() to add elements.
- Field access via the handle.
- for..of iteration.
- swapRemove or remove.
- Column access.
- drop().

Keep it concise and runnable via `bun run examples/vec-demo.ts`. Use deterministic output (no Math.random) so it can serve as a regression check.

### 4. Tests -- `tests/vec/vec-iterator.test.ts`

At minimum:

- `for..of` iterates all elements in order (0 to len-1).
- Values read during iteration match what was pushed.
- Iterator yields the same handle instance at every step (reference equality on consecutive yields via manual iterator protocol).
- `handle.slot` inside the loop equals the expected index.
- `for..of` on empty vec: loop body never executes.
- `for..of` after push+pop (partial fill): iterates only over live elements.
- `for..of` after drop throws "vec has been dropped" (or the iterator gracefully stops -- builder decides on the exact behavior and documents it, but the contract says all operations throw after drop).
- Spread `[...vec]` works and produces an array of handles (all same reference) or field snapshots -- document the behavior.
- Nested struct access works inside for..of: `for (const h of vec) { h.pos.x ... }`.

### 5. Integration test -- import from 'rigidjs' public API

Add or extend a test that imports `{ struct, vec }` from the package entry point (or `../src/index.js`) and verifies the full round-trip: struct definition, vec creation, push, iterate, drop. This confirms the re-export wiring is correct.

### 6. Verify examples run

Run `bun run examples/particles.ts` and verify output is unchanged (slab example regression check).
Run `bun run examples/vec-demo.ts` and verify it produces expected output.

## Acceptance Criteria

- [ ] `bun test` exits 0 with zero failing tests. Total test count increases.
- [ ] `bun run typecheck` exits 0.
- [ ] `for..of vec` works correctly for iteration over all elements.
- [ ] `vec` and `Vec` are exported from `src/index.ts`.
- [ ] `import { struct, slab, vec } from '../src/index.js'` compiles and works in tests.
- [ ] `examples/vec-demo.ts` runs successfully via `bun run examples/vec-demo.ts`.
- [ ] `examples/particles.ts` still runs with unchanged output.
- [ ] All existing slab/struct tests pass unchanged.
- [ ] `src/slab/**`, `src/struct/**`, `src/types.ts` unchanged.
- [ ] `benchmark/**` unchanged.
- [ ] No new runtime dependencies.
- [ ] No `/tmp` scripts.
- [ ] No `Proxy` introduced.
- [ ] Reminder to builder-agent: **do not update `.chief/milestone-4/_plan/_todo.md`**.

## Out of Scope

- Benchmarks -- task-5.
- Slab free-list optimization -- task-4.
- `.iter()` lazy chain -- milestone-5.
- `for..of` on slab -- milestone-5.
- Modifying `examples/particles.ts`.

## Notes

- The iterator protocol in JS requires `next()` to return `{ value, done }`. Each call to next() technically creates one JS object if not reused. For the MVP, creating a fresh `{ value, done }` per call is fine -- it is one allocation per iteration step, which is standard. If this becomes a bottleneck in benchmarks (task-5), it can be optimized in a follow-up.
- `[...vec]` will produce an array where every element is the same handle reference (because of handle reuse). This is expected and consistent with the handle-reuse contract. Users who want materialized values should capture field values, not handle references.
- The vec example should be self-contained and not import from the test infrastructure. Pure `rigidjs` public API usage.
- Definition of done per `.chief/_rules/_verification/verification.md`: `bun test` passes, `bun run typecheck` passes, at least one new test per new public symbol.
