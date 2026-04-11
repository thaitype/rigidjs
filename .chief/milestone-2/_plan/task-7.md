# Task 7 — Performance Benchmark Suite (B1/B2/B3/B7)

## Objective

Add a standalone `benchmark/` suite that measures plain JS object patterns against RigidJS `struct` + `slab` for four scenarios from the design spec (B1, B2, B3, B7). The suite runs via `bun run bench`, prints a summary table, and writes a machine-readable JSON plus a human-readable markdown report into `.chief/milestone-2/_report/task-7/`.

This task is purely additive. It must not touch `src/**`, must not add dependencies, and must not affect `bun test` or `bun run typecheck` in any way other than type-checking the new files.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/layout.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
6. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` — §7.1 metrics, §7.2 harness, §7.3 scenarios, §7.4 expected results
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_goal/goal.md`
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_contract/public-api.md`
9. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-5.md`
10. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-6.md`
11. Existing source: `src/index.ts`, `src/slab/slab.ts`, `examples/particles.ts`, `package.json`, `tsconfig.json`

## Scope Guardrails

- **Public API only.** Benchmark code imports exclusively from `../src/index.js` (re-exports: `struct`, `slab`, types). Do NOT reach into `src/struct/**` or `src/slab/**` internals.
- **No edits to `src/**`.** If a scenario cannot be written without touching `src/`, stop and escalate — do not work around it.
- **No edits to `tests/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, or `.chief/milestone-2/_contract/**`, or the design spec.**
- **No new dependencies.** `package.json`'s `dependencies`, `devDependencies`, and `peerDependencies` stay untouched except for the single `bench` script entry.
- **Benchmarks are not tests.** No benchmark file lives under `tests/`. `bun test` must not pick up or run any benchmark code.
- **TypeScript strict mode applies.** Zero `any` / `unknown` in function signatures that cross the harness/scenario boundary. If internal cast helpers are needed (e.g. the harness stores heterogeneous scenario functions), isolate and document them with a one-line comment.
- **No hidden allocations in the measurement loop.** The per-iteration latency buffer must be pre-sized (see Deliverable 1 and Notes).

## Deliverables

### 1. `benchmark/harness.ts` — bench runner primitive

Create `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts` with:

- Import `heapStats` from `bun:jsc`.
- Export the `BenchResult` interface exactly as below:

  ```ts
  export interface BenchResult {
    name: string
    opsPerSec: number
    heapObjectsBefore: number
    heapObjectsAfter: number
    heapObjectsDelta: number
    heapSizeMB: number
    rssMB: number
    p50Us: number
    p99Us: number
  }
  ```

- Export a `Scenario` interface:

  ```ts
  export interface Scenario {
    name: string
    setup: () => void
    fn: () => void
    teardown?: () => void
    iterations?: number
    warmup?: number
  }
  ```

- Export an async function `bench(scenario: Scenario): Promise<BenchResult>`.

  Behavior:
  1. Run `scenario.setup()`.
  2. Warmup: run `scenario.fn()` `warmup` times (default 1_000) without timing.
  3. Force `Bun.gc(true)` then `await Bun.sleep(100)`.
  4. Snapshot `heapStats()` → `heapBefore`.
  5. Pre-allocate latency buffer: `const latencies = new Float64Array(iterations)` (default 10_000). Index-assign inside the loop — **never** `.push()`.
  6. Timed loop: for each iteration, record `t0 = Bun.nanoseconds()`, run `fn()`, write `latencies[i] = Bun.nanoseconds() - t0`. Track `elapsed` as the full-loop delta (not the sum of per-iteration deltas — the outer `Bun.nanoseconds()` bookends are the source of truth for `opsPerSec`).
  7. Force `Bun.gc(true)` then `await Bun.sleep(100)`.
  8. Snapshot `heapStats()` → `heapAfter`.
  9. Run `scenario.teardown?.()`.
  10. Sort `latencies` (in-place via `Float64Array.prototype.sort`) and compute p50 / p99 in microseconds (`ns / 1000`). Round to 2 decimal places.
  11. Return a `BenchResult` with `rssMB` from `process.memoryUsage().rss`.

- Export a helper `async function runAll(scenarios: Scenario[]): Promise<BenchResult[]>` that, between scenarios, additionally calls `Bun.gc(true)` + `await Bun.sleep(100)` so prior heap state does not bleed across runs.

- Export a helper `formatTable(results: BenchResult[]): string` that returns a plain-text fixed-width table suitable for printing to stdout. Columns: `name`, `ops/s`, `heapΔ`, `heapMB`, `rssMB`, `p50µs`, `p99µs`.

Type rules:
- `bench`, `runAll`, and `formatTable` have explicit return types.
- No `any` in exported signatures.
- If a cast is needed inside the harness (e.g. pre-filling the `Float64Array`), wrap it in a commented one-liner.

### 2. `benchmark/scenarios/b1-struct-creation.ts` — B1

Scenario: create 100,000 entities. Compare plain JS baseline vs RigidJS `slab`.

- `b1JsBaseline: Scenario`
  - `setup`: no-op.
  - `fn`: allocate a fresh `const arr: { x: number; y: number; z: number }[] = new Array(100_000)`; fill each index with `{ x: i, y: i, z: i }`.
  - `iterations`: 10 (each iteration constructs 100k objects — 10 is enough to smooth noise without blowing the test time). `warmup`: 2.
- `b1RigidJs: Scenario`
  - `setup`: no-op.
  - `fn`: build `const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })`, then `const s = slab(Vec3, 100_000)`, then loop 100k times calling `s.insert()` and writing `.x`, `.y`, `.z`. Call `s.drop()` at end of `fn`.
  - `iterations`: 10. `warmup`: 2.

Export as a named tuple: `export const b1Scenarios: Scenario[] = [b1JsBaseline, b1RigidJs]`.

Key metric for the report: `heapObjectsDelta`.

### 3. `benchmark/scenarios/b2-insert-remove-churn.ts` — B2

Scenario: 100 frames of "10,000 insert + 10,000 remove".

- `b2JsBaseline: Scenario`
  - `setup`: pre-allocate `const pool: Array<{ x: number; y: number; z: number } | null> = new Array(10_000).fill(null)` and a free-list `const free: number[] = Array.from({ length: 10_000 }, (_, i) => 10_000 - 1 - i)`. Justification: mirrors slab's LIFO free-list to keep the comparison fair — see Notes.
  - `fn`: one "frame" = push 10k `{ x, y, z }` into free slots, then remove all 10k by setting the slot to `null` and pushing the index back on `free`. Use a pre-existing `frame` counter closed over by the scenario module so the warmup state is reset by `setup` for every run.
  - `iterations`: 100 (one iteration = one frame). `warmup`: 10.
- `b2RigidJs: Scenario`
  - `setup`: `const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' }); const s = slab(Vec3, 10_000)`. Pre-allocate `const slots: Int32Array = new Int32Array(10_000)` for captured slot indices (pre-sized, no `.push()`).
  - `fn`: one frame = 10k `insert()` capturing `.slot` into `slots[i]`, then 10k `remove(slots[i])`. Do NOT `drop()` between frames — the slab is reused.
  - `teardown`: `s.drop()`.
  - `iterations`: 100. `warmup`: 10.

Key metric for the report: `p99Us`.

Export `b2Scenarios`.

### 4. `benchmark/scenarios/b3-iterate-mutate.ts` — B3

Scenario: iterate 100k entities and increment `pos.x` by `vel.x` (simple physics step).

- `b3JsBaseline: Scenario`
  - `setup`: build `const arr = new Array(100_000)` pre-filled with `{ pos: { x: i, y: 0, z: 0 }, vel: { x: 1, y: 0, z: 0 } }` objects. The setup is done once; the timed `fn` must not re-create the array.
  - `fn`: standard `for (let i = 0; i < arr.length; i++) { const o = arr[i]; o.pos.x += o.vel.x }`.
  - `iterations`: 100 (one iteration = one full 100k sweep). `warmup`: 10.
- `b3RigidJs: Scenario`
  - `setup`: build `const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })`, `const Particle = struct({ pos: Vec3, vel: Vec3 })`, `const s = slab(Particle, 100_000)`, then fill 100k slots with the same initial values.
  - `fn`: `for (let i = 0; i < s.capacity; i++) { if (!s.has(i)) continue; const h = s.get(i); h.pos.x += h.vel.x }`.
  - `teardown`: `s.drop()`.
  - `iterations`: 100. `warmup`: 10.

Key metric for the report: `opsPerSec`.

Export `b3Scenarios`.

### 5. `benchmark/scenarios/b7-nested-struct.ts` — B7

Scenario: 50,000 Particle-like entities with nested `pos` / `vel`. THREE runs:

- `b7JsNestedBaseline: Scenario`
  - `fn`: allocate a fresh array of 50k objects each shaped `{ pos: { x, y, z }, vel: { x, y, z }, life: 1, id: i }`. `iterations`: 10, `warmup`: 2.
- `b7JsFlatBaseline: Scenario`
  - `fn`: allocate a fresh array of 50k objects each shaped `{ posX, posY, posZ, velX, velY, velZ, life, id }`. Same iteration count.
- `b7RigidJs: Scenario`
  - `fn`: `const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })`, `const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })`, `const s = slab(Particle, 50_000)`, fill all 50k slots with numeric values. `s.drop()` at end of `fn`. Same iteration count.

Key metrics for the report: `heapObjectsDelta`, `heapSizeMB`, `rssMB`.

Export `b7Scenarios` (length 3).

### 6. `benchmark/run.ts` — entry runner

Create `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`. This file is the entry point for `bun run bench`.

It must:

1. Import `runAll`, `formatTable`, `BenchResult` from `./harness.js`.
2. Import the four scenario arrays from `./scenarios/b1-struct-creation.js`, `./scenarios/b2-insert-remove-churn.js`, `./scenarios/b3-iterate-mutate.js`, `./scenarios/b7-nested-struct.js`.
3. Concatenate all scenarios in order B1 → B2 → B3 → B7, then `await runAll(allScenarios)`.
4. `console.log(formatTable(results))`.
5. Build a metadata block:

   ```ts
   const meta = {
     bunVersion: Bun.version,
     platform: process.platform,
     arch: process.arch,
     date: new Date().toISOString(),
   }
   ```

6. Write `.chief/milestone-2/_report/task-7/results.json` with shape:

   ```json
   { "meta": { ... }, "results": [ BenchResult, ... ] }
   ```

   Use `await Bun.write(path, JSON.stringify(payload, null, 2))`. If the directory does not exist, create it first (use `import { mkdir } from 'node:fs/promises'` with `{ recursive: true }`).

7. Write `.chief/milestone-2/_report/task-7/benchmark.md`: a human-readable report with:
   - Top matter: bun version, platform/arch, date.
   - One H2 section per scenario (`## B1 — Struct creation`, `## B2 — Insert/remove churn`, `## B3 — Iteration + mutate`, `## B7 — Nested struct (Particle)`).
   - Each section contains a small markdown table of the relevant runs for that scenario (pulled from `results`) and a 2–3 sentence interpretation anchored on that scenario's key metric (e.g. "B1 shows N fewer GC-tracked objects for RigidJS vs plain JS").
   - A closing "Caveats" paragraph stating: single-run numbers are noisy, machine-dependent, and scenarios B4/B5/B6 are deferred until `.iter()`, `bump()`, and `vec()` land.
   - A final line pointing at `results.json` for machine consumers.

8. Exit code: `process.exit(0)` on success. Do not swallow errors — uncaught exceptions should surface and exit non-zero naturally.

File paths for output:
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-7/results.json`
- `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-7/benchmark.md`

### 7. `package.json` — add `bench` script

Add exactly one line to the `scripts` block:

```json
"bench": "bun run benchmark/run.ts"
```

Do not touch any other field. Do not add dependencies. Do not reorder keys.

## Acceptance Criteria

- [ ] `bun run bench` exits 0
- [ ] `bun run bench` prints a fixed-width summary table to stdout covering all scenarios in B1/B2/B3/B7
- [ ] `.chief/milestone-2/_report/task-7/results.json` exists, parses as valid JSON via `JSON.parse(await Bun.file(path).text())`, and contains a top-level `meta` object with `bunVersion`/`platform`/`arch`/`date`, plus a `results` array whose every element has all nine `BenchResult` fields
- [ ] `.chief/milestone-2/_report/task-7/benchmark.md` exists and contains the four H2 sections `## B1`, `## B2`, `## B3`, `## B7`, plus a "Caveats" block and a reference to `results.json`
- [ ] `bun test` still exits 0 with the same number of tests as before this task — `grep -rn "benchmark" tests/` returns zero matches
- [ ] `bun run typecheck` exits 0 and includes the new `benchmark/**` files in its coverage (see Notes §Typecheck)
- [ ] `grep -rn "Proxy" src/` returns zero matches (sanity check that nothing in `src/**` was touched)
- [ ] `grep -rn "from '\.\./src/" benchmark/` shows every benchmark file importing exclusively from `'../src/index.js'` — no deep imports into `src/struct/**` or `src/slab/**`
- [ ] `bun run examples/particles.ts` still prints the same four-line summary it printed after task-6
- [ ] `package.json` has the `bench` script and no new entries in `dependencies`, `devDependencies`, or `peerDependencies`
- [ ] No benchmark file uses `any` in an exported signature; no benchmark file uses `Proxy`; no benchmark file uses `.push()` inside a timed loop
- [ ] `git status` shows new files only under `benchmark/`, `.chief/milestone-2/_report/task-7/`, `.chief/milestone-2/_plan/_todo.md`, and `package.json` — no modifications under `src/`, `tests/`, `examples/`, or `tsconfig.json`

## Out of Scope (Explicit)

- Scenarios B4, B5, B6 — they require `.iter()`, `bump()`, and `vec()` which do not exist yet
- Regression gate / CI threshold check (spec §7.6)
- Adding benchmarks to the `bun test` run
- Lint, format, or new tooling
- New runtime or dev dependencies
- Editing `src/**`, `tests/**`, `examples/**`, `tsconfig.json`, `CLAUDE.md`, or any file under `.chief/_rules/**`
- Editing the design spec or the public-api contract
- GC pause histograms, `numberOfDFGCompiles()`, native heap stats — nice to have but not required
- Multi-run averaging, error bars, or statistical significance tests

## Notes

### Pre-sized latency buffer

The spec §7.2 example uses `const latencies: number[] = []` and `.push()` inside the hot loop. That is acceptable as spec pseudocode but is a measurement hazard: `.push()` on a growing array triggers reallocation and GC work that gets counted against the scenario being measured. This task's harness must pre-size the buffer (`new Float64Array(iterations)`) and index-assign. The sort for p50/p99 happens after the timing window closes.

### JS baseline choices

- **B2 (insert/remove churn).** The JS baseline is a pre-sized `Array<T | null>` with a numeric free-list — not `Set<object>`, not `Array.push/splice`. Reason: `Set<object>` hides per-item object allocation behind a different abstraction and makes the comparison about data structures rather than GC pressure; `Array.push/splice` has O(n) semantics that unfairly penalize the baseline. A pre-sized array with a free-list mirrors slab's structure, so the remaining delta is purely about object layout (hidden class + GC tracking), which is what the benchmark is trying to isolate.
- **B3 (iterate + mutate).** The JS baseline is a flat `Array<object>` of typed objects. Not a `Map<number, object>`, not a sparse array with tombstones. Reason: `Array<object>` is the idiomatic "perf-aware JS dev" choice and is the fairest baseline for a dense iteration workload.
- **B7 (nested struct).** Two JS baselines (nested + flat) because the design spec §7.4 claims RigidJS wins on object count vs nested JS specifically. The flat baseline is there to show that even when JS devs pre-flatten (which is already a performance optimization), RigidJS still wins on `heapObjectsDelta` and memory.

### Deferred scenarios

B4 requires `.iter()`, B5 requires `bump()`, B6 requires `vec()`. None of these are implemented in milestone-2. The benchmark.md "Caveats" section must call this out explicitly so readers do not misread the suite as the full §7.3 table.

### Typecheck

`tsconfig.json` at the repo root has no `include` / `files` / `exclude` array. Per TypeScript's default rules, `tsc --noEmit` with no `include` pulls in every `.ts` / `.tsx` file under the root (subject to `exclude` defaults like `node_modules`). That means `benchmark/**/*.ts` is automatically type-checked by `bun run typecheck` — **no tsconfig change is required**.

Action for the builder: after adding the files, run `bun run typecheck` once and confirm a type error deliberately introduced into `benchmark/harness.ts` is caught (then remove the error). If typecheck does NOT cover `benchmark/**` for some reason, stop and escalate to chief-agent — do not silently add an `include` array.

### Import path convention

Use `'../src/index.js'` (with the `.js` extension) from benchmark files, matching the existing style in `examples/particles.ts` and tests. `verbatimModuleSyntax` is on, so the extension is required.

### Determinism

These benchmarks are not deterministic. They are reference measurements. The acceptance criteria intentionally only check that the suite runs, exits 0, and produces the two report files with the right structure — not that specific throughput numbers are hit. Regression gates are deferred.

### Handle reuse reminder

In B3's RigidJS scenario, `s.get(i)` always returns the same handle instance rebased to slot `i`. Inside the `fn` loop, assigning to `h.pos.x` mutates the underlying buffer at slot `i`'s offset — exactly what the scenario wants. Do not attempt to hoist `const h = s.get(i)` above the loop; that would pin it to one slot.

## Verification Commands

```bash
bun run bench
bun test
bun run typecheck
bun run examples/particles.ts
cat .chief/milestone-2/_report/task-7/results.json | head
cat .chief/milestone-2/_report/task-7/benchmark.md | head
grep -rn "Proxy" src/
grep -rn "benchmark" tests/
grep -rn "from '\.\./src/" benchmark/
```

Expected results for each command are listed in the Acceptance Criteria above.
