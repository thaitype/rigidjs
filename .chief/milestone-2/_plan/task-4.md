# Task 4 — Public API Wiring, `examples/particles.ts`, and Milestone-2 Acceptance

## Objective
Expose `slab`, `Slab`, and `Handle` from the public package entry, write the end-to-end `examples/particles.ts` demonstration, and produce the milestone-2 acceptance report mapping every success criterion in `_goal/goal.md` to concrete evidence.

## Inputs (read before starting)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_contract/public-api.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_contract/public-api.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_goal/goal.md` (§Success Criteria is the authoritative checklist)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md` (`src/index.ts` is re-exports only)
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
- `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` §4.2 (the particles example sketch)
- Task-1, task-2, task-3 outputs

## Deliverables
- `/Users/thada/gits/thaitype/rigidjs/src/index.ts`
  - After this task:
    ```ts
    export { struct } from './struct/struct.js'
    export { slab } from './slab/slab.js'
    export type { StructDef, StructFields, NumericType } from './types.js'
    export type { Slab, Handle } from './slab/slab.js'
    ```
  - No logic. No default export. No other symbols.
- `/Users/thada/gits/thaitype/rigidjs/examples/particles.ts`
  - A runnable end-to-end example:
    1. `import { struct, slab, type Slab } from '../src/index.js'` (or whatever path works with the project's `tsconfig`).
    2. Define `Vec3` and `Particle` exactly as shown in the design spec §4.1.
    3. Create `const particles = slab(Particle, 1024)`.
    4. Insert N particles (e.g. `N = 500`) with deterministic initial values so the output is reproducible. Use a simple LCG or `i`-based formulas — no `Math.random()` (so acceptance output is stable across runs).
    5. Run a fixed-step simulation tick: for each slot `i` in `0..N`, if `particles.has(particles.get(i))`, integrate position by velocity and decrement `life`.
    6. Remove every particle whose `life` dropped below zero.
    7. Print a summary via `console.log`:
       - `particles.capacity`
       - `particles.len` (after removal)
       - The sum of `pos.x` across all still-alive particles (or any deterministic aggregate)
       - A fixed "alive" count after N ticks
    8. Call `particles.drop()` at the end.
  - Must be runnable via `bun run examples/particles.ts` and must exit cleanly (exit code 0).
  - Uses ONLY public imports. No reaching into `src/internal/` or `src/slab/bitmap.js`.
  - Demonstrates: `struct` with nested field, `slab` creation, `insert`, field writes on nested struct, `get(i)`, `has(handle)`, `remove(handle)`, `.len`, `.capacity`, `.drop()`.
  - Does NOT use `.iter()` or `for..of slab` — those are out of scope for milestone-2. Use a plain `for (let i = 0; i < particles.capacity; i++)` loop with `has(get(i))` guards.
- `/Users/thada/gits/thaitype/rigidjs/tests/public-api/milestone-2.test.ts`
  - Imports **only** from `../../src/index.js`:
    ```ts
    import { struct, slab, type Slab, type Handle, type StructDef } from '../../src/index.js'
    ```
  - Asserts:
    - `typeof slab === 'function'`.
    - `slab(struct({ x: 'f64' }), 4).capacity === 4`.
    - `Slab` and `Handle` are usable as type annotations (compile-only check — a variable annotated `const s: Slab<{ x: 'f64' }> = slab(...)` that typechecks is sufficient).
    - Insert-then-get returns the same handle instance (reference equality).
    - `slab(struct({ x: 'f64' }), 0)` throws.
    - Use-after-drop throws.
  - This test is the public-surface canary — it mirrors `tests/struct/public-api.test.ts` from milestone-1.
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-4/acceptance.md`
  - A short report that lists every checkbox from `.chief/milestone-2/_goal/goal.md` §Success Criteria and maps it to evidence:
    - Test name(s) that prove it
    - Grep command outputs for the "no Proxy" / "one ArrayBuffer" checks
    - `bun run examples/particles.ts` captured stdout
    - `bun test` summary
    - `bun run typecheck` summary
  - Also records:
    - Line counts of `src/slab/slab.ts`, `src/slab/bitmap.ts`, `examples/particles.ts`
    - Zero-runtime-dependency confirmation (`package.json` `dependencies` is empty or absent)
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-4/particles-output.txt`
  - Captured stdout of a `bun run examples/particles.ts` run. Used as the reproducibility baseline.

## Acceptance criteria
All items from `.chief/milestone-2/_goal/goal.md` §Success Criteria:
- [ ] `bun test` passes with every milestone-1 test still green plus full milestone-2 coverage
- [ ] `bun run typecheck` exits 0
- [ ] `slab` and `Slab` exported from `rigidjs` (verified by `tests/public-api/milestone-2.test.ts`)
- [ ] `Handle<F>` is usable as a type annotation (compile-only check in the same test file)
- [ ] `grep -rn "Proxy" src/` returns zero matches
- [ ] `grep -rn "new Function" src/` matches only inside `src/struct/handle-codegen.ts`
- [ ] No per-call JS object allocation in `insert`/`remove`/`get`/`has` — reviewer check against `_standard/memory-and-perf.md`; record the review verdict in the acceptance report
- [ ] `examples/particles.ts` runs cleanly via `bun run examples/particles.ts` and prints the documented summary; exit code 0
- [ ] `struct()` API (sizeof, fields, behavior) is unchanged from milestone-1 — all milestone-1 tests still pass
- [ ] Zero runtime dependencies — `package.json` `dependencies` empty
- [ ] `src/index.ts` contains ONLY `export { ... } from '...'` and `export type { ... } from '...'` statements (verify with a grep for forbidden keywords: `function`, `class`, `const`, `let` inside `src/index.ts` should return zero matches)
- [ ] Design spec `.chief/_rules/_goal/rigidjs-design-spec-v3.md` is unmodified (`git status`)
- [ ] `.chief/milestone-2/_report/task-4/acceptance.md` exists and maps every success criterion to evidence
- [ ] `examples/particles.ts` output captured at `.chief/milestone-2/_report/task-4/particles-output.txt`
- [ ] `src/internal/single-slot.ts` is still not re-exported from `src/index.ts`

## Out of scope
- `.iter()`, `for..of`, object-form `insert({...})`, `vec()`, `bump()`, string types — all deferred
- Benchmark harness / perf gates
- CI / lint configuration
- README update (unless trivially needed — otherwise defer)

## Notes
- `examples/particles.ts` must be **deterministic** so the captured output is stable. No `Math.random`, no `Date.now`, no wall-clock time. Use integer math or a tiny LCG seeded with a constant.
- The example doubles as the acceptance driver. Keep it under ~80 lines. It is documentation, not a benchmark — no timing code, no heap stats.
- `src/index.ts` uses `export type { ... }` for type re-exports. Runtime exports (`struct`, `slab`) use `export { ... }`.
- When validating "no per-call allocation" in the reviewer check, inspect `src/slab/slab.ts` for:
  - object literals inside `insert`/`remove`/`get`/`has`/`clear`
  - array literals inside those methods
  - arrow functions/closures created inside those methods
  - `new X(...)` calls inside those methods (other than throwing Errors)
  If any are found, file them as findings and delegate a fix back to task-3 before signing off.
- The acceptance report is the hand-off document that closes milestone-2. Write it last, after `bun test` and `bun run typecheck` both pass and the example runs cleanly.
- If a success criterion cannot be satisfied without breaking task 1–3 or an earlier contract, STOP and escalate to chief-agent — do not silently weaken the contract.
- Package.json main/entry may need no change: `src/index.ts` is still the entry. Do not restructure the package layout in this task.
