# Task 9 — Sustained-Load Benchmarks (B8/B9) for GC-Pressure Thesis

## Objective

Add two new benchmark scenarios — **B8 (sustained churn under time budget)** and **B9 (heap-pressure scaling curve)** — to test the real RigidJS value proposition in hard numbers. Task-7 shipped B1/B2/B3/B7 and task-8 fixed the allocation-pressure measurement, producing an honest picture:

- RigidJS allocates **~300x fewer GC-tracked objects** than plain JS at 100k entities.
- RigidJS is **2.6x–6.2x slower** than plain JS on raw per-operation throughput at small-to-medium scales (DataView dispatch cost > JIT-inlined hidden-class access once the JIT is warm).

The RigidJS thesis is **not** "tight loops run faster." It is **"your app stops pausing"** — two orders of magnitude fewer GC-tracked objects should translate to lower p99 tick latency and less wall-clock time lost to GC under sustained workloads. Task-9's job is to **design benchmarks that actually prove or disprove that thesis** and report the truth, whichever way the numbers fall.

This task is purely additive to the benchmark suite. It must not touch `src/**`, `tests/**`, `examples/**`, `package.json`, `tsconfig.json`, the design spec, `CLAUDE.md`, `.chief/_rules/**`, or `.chief/milestone-2/_contract/**`. It must not modify the existing task-7 or task-8 report files. It must not change the existing `bench`, `BenchResult`, or `Scenario` shapes — all harness extensions are **additive**.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` — §1 problem statement (GC pressure thesis), §7 benchmarks
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-7.md` — format reference and prior harness contract
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-8.md` — allocation-measurement trick (sum of `heapStats().objectTypeCounts`, NOT the stale `objectCount`)
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-7/benchmark.md` — prior interpretation
9. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-7/results.json` — raw task-7/task-8 data
10. Existing benchmark source:
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b1-struct-creation.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b2-insert-remove-churn.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b3-iterate-mutate.ts`
    - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b7-nested-struct.ts`

## Scope Guardrails

- **Benchmark-only surface area.** All edits land under `benchmark/**` plus new files under `.chief/milestone-2/_report/task-9/`. Nothing else.
- **No edits to `src/**`, `tests/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, `.chief/milestone-2/_contract/**`, the design spec, `tsconfig.json`, or `package.json`.** If the fix appears to require any of these, stop and escalate.
- **No new dependencies.** `package.json`'s `dependencies`, `devDependencies`, and `peerDependencies` stay byte-identical. The existing `bench` script (`"bench": "bun run benchmark/run.ts"`) is unchanged.
- **Public API only.** Benchmark files import exclusively from `'../../src/index.js'` (and `'../src/index.js'` from the `benchmark/` root for `run.ts`). No deep imports into `src/struct/**` or `src/slab/**`.
- **Existing B1/B2/B3/B7 results stay byte-for-byte unchanged** unless the harness extension forces a minor additive type-signature update. Additive means: new optional fields, new interfaces, new functions. Not: renaming, reordering, or removing anything already exported.
- **Task-7 and task-8 report files are NOT modified.** Task-9 writes to its own new directory `.chief/milestone-2/_report/task-9/`.
- **TypeScript strict mode applies.** Zero `any` in exported signatures. `unknown` is allowed where genuinely heterogeneous (same rule as task-8).
- **No hidden allocations in the measurement window.** The per-tick latency buffer must be pre-sized. Do not `.push()` inside the timing loop. Do not create closures, intermediate arrays, or strings mid-tick.
- **Benchmarks are not tests.** No benchmark file lives under `tests/`. `bun test` must not pick up B8/B9 code.
- **Must reuse the task-8 `liveObjectCount(heapStats())` helper** (sum of `objectTypeCounts`). Do NOT re-introduce the stale `heapStats().objectCount` field. If that helper currently lives inline inside `bench()`, extract it as a private exported helper from `harness.ts` so B8/B9 can call it — that counts as additive.

## Deliverables

### 1. `benchmark/harness.ts` — extend with sustained-mode primitives

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`. All changes are **additive**. The existing `bench`, `runAll`, `formatTable`, `BenchResult`, and `Scenario` are untouched in behavior and shape.

Add the following exports:

- `SustainedScenario` interface:

  ```ts
  export interface SustainedScenario {
    name: string
    setup?: () => void
    tick: () => void
    teardown?: () => void
    /** Wall-clock duration budget in milliseconds. */
    durationMs: number
    /** Number of ticks to run untimed before measurement (default 50). */
    warmupTicks?: number
    /**
     * Optional one-shot allocation measurement, same contract as Scenario.allocate
     * from task-8. If present, the harness runs it once before the timing window
     * and records allocationDelta. If absent, allocationDelta is null.
     */
    allocate?: () => unknown
  }
  ```

- `SustainedResult` interface:

  ```ts
  export interface SustainedResult {
    name: string
    /** Capacity tag for B9 scaling runs; undefined for plain B8. */
    capacity?: number
    ticksCompleted: number
    meanTickMs: number
    stdDevTickMs: number
    p50TickMs: number
    p99TickMs: number
    p999TickMs: number
    maxTickMs: number
    /** Optional one-shot allocation pressure from scenario.allocate(). */
    allocationDelta: number | null
    heapSizeMB: number
    rssMB: number
  }
  ```

- `async function benchSustained(scenario: SustainedScenario): Promise<SustainedResult>`:

  Behavior in order:

  1. `scenario.setup?.()`.
  2. If `scenario.allocate` is defined, run the one-shot allocation phase (reuse the task-8 logic: sample live object count before, call `allocate()` and retain its return value in a wide-scoped `let`, sample live object count after, `void retained` anti-DCE, then `retained = null` + `Bun.gc(true)` + `await Bun.sleep(100)`). Use the **task-8 `liveObjectCount(heapStats())` helper** — sum of `objectTypeCounts`. Do NOT use the stale `heapStats().objectCount` field. If `allocate` is absent, `allocationDelta = null`.
  3. `Bun.gc(true)` + `await Bun.sleep(100)`.
  4. Warmup: run `scenario.tick()` `warmupTicks` times (default 50) with no timing to prime the JIT.
  5. `Bun.gc(true)` + `await Bun.sleep(100)`.
  6. Pre-size the latency buffer conservatively: `const maxTicks = Math.ceil(scenario.durationMs * 2)` (allows up to ~2000 ticks/sec before overflowing — plenty of headroom). Allocate `const latencies = new Float64Array(maxTicks)`. Index-assign only. If the tick count ever exceeds `maxTicks`, the harness must throw with a clear error message naming the scenario and the observed tick count — **do not** silently grow the buffer or truncate.
  7. Timing loop: capture `const windowStart = Bun.nanoseconds()` and `const deadline = windowStart + scenario.durationMs * 1_000_000`. Loop: record `t0 = Bun.nanoseconds()`, run `tick()`, write `latencies[ticksCompleted] = Bun.nanoseconds() - t0`, increment `ticksCompleted`, check `Bun.nanoseconds() < deadline`. Stop when the deadline is hit. The latency value stored is nanoseconds; conversion to ms happens after the window closes.
  8. Runaway-tick guard: wrap the timing loop with a hard wall-clock ceiling of `scenario.durationMs * 3` ms. If the loop has not exited by then, throw with a clear error message. This protects against a single tick taking longer than the entire budget (infinite loop, pathological GC, etc.).
  9. `scenario.teardown?.()`.
  10. `Bun.gc(true)` + `await Bun.sleep(100)`. Sample `heapStats()` and `process.memoryUsage().rss` for `heapSizeMB` / `rssMB`.
  11. Slice the filled prefix: `const used = latencies.subarray(0, ticksCompleted)`. Compute:
      - `meanTickMs` — mean of `used`, converted ns → ms.
      - `stdDevTickMs` — population standard deviation, converted ns → ms.
      - Sort a copy for percentiles: `const sorted = new Float64Array(used); sorted.sort()`. Then `p50TickMs`, `p99TickMs`, `p999TickMs`, `maxTickMs` using index-based percentile (`sorted[Math.floor(n * p)]` for p ∈ {0.5, 0.99, 0.999}; `maxTickMs = sorted[n - 1]`).
      - All ms values formatted to 4 decimal places of precision (tick latencies may legitimately be microseconds).
  12. Return the `SustainedResult` object with `capacity` left `undefined` unless set by `benchScaling` (see next).

- `async function benchScaling<T>(scenarioFactory: (capacity: number) => SustainedScenario, capacities: number[]): Promise<SustainedResult[]>`:

  For each capacity in order, build a fresh scenario via `scenarioFactory(capacity)`, call `benchSustained(scenario)`, then set `result.capacity = capacity` on the returned object before pushing into the results array. Between capacities, call `Bun.gc(true)` + `await Bun.sleep(100)` to reset heap state. Return the array.

- `function formatSustainedTable(results: SustainedResult[]): string`:

  Returns a plain-text fixed-width table. Columns: `name`, `cap` (render `undefined` as `-`), `ticks`, `meanMs`, `p50Ms`, `p99Ms`, `p999Ms`, `maxMs`, `allocΔ` (render `null` as `-`), `heapMB`, `rssMB`. Column widths may be whatever fits comfortably. Header row and data rows must align.

- **Extract the live-object-count helper** from its current inline form in `bench()` into a module-private function (or exported as `liveObjectCount(stats: ReturnType<typeof heapStats>): number` — exporting it is fine and encouraged). Both `bench()` and `benchSustained()` must call it. This avoids duplicating the "sum over `objectTypeCounts`" logic.

Type rules:
- Explicit return types on all new exported functions.
- No `any` in exported signatures.
- `unknown` is allowed as the return type of `SustainedScenario.allocate` (same rationale as task-8).
- The `void retained` anti-DCE statement must carry a one-line comment explaining its purpose, same as task-8.

### 2. `benchmark/scenarios/b8-sustained-churn.ts` — B8

Create `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b8-sustained-churn.ts` exporting two sustained scenarios: one JS baseline, one RigidJS.

**Constants at the top of the file** (for easy tuning during builder-side measurement):

```ts
const DURATION_MS = 10_000
const CAPACITY = 100_000
const INITIAL_FILL = 50_000
const CHURN_PER_TICK = 1_000
const DT = 0.016
```

**Workload per tick (both variants)**:
1. Insert `CHURN_PER_TICK` new entities (fresh position/velocity/life/id).
2. Remove `CHURN_PER_TICK` oldest entities from the rolling FIFO queue.
3. Iterate all currently-occupied slots and mutate `pos.x += vel.x * DT`.

**Initial state** (set up once in `setup`, before any measurement):
Fill the container to `INITIAL_FILL` entities and push each slot key (or array index) onto a rolling FIFO queue (`Int32Array` of size `CAPACITY`, head/tail indices). The FIFO queue is how both variants decide which slot to remove on each tick — "remove the oldest", not "remove the one we just inserted". This guarantees the churn actually moves through the heap and does not degenerate into a LIFO stack that keeps the same working set.

**`b8JsBaseline: SustainedScenario`**:
- JS-baseline choice: **array + numeric free-list** (NOT `Map<number, Entity>`). Document the choice inline with a comment block citing the reasoning below (from Design Notes §JS baseline choice).
- Pre-sized `Array<Entity | null>(CAPACITY)` storage; `Int32Array(CAPACITY)` free-list with a top pointer; `Int32Array(CAPACITY)` FIFO queue with head/tail indices.
- Each `Entity` is a plain object `{ pos: { x, y, z }, vel: { x, y, z }, life: number, id: number }` with **nested** `pos` / `vel`. This is the idiomatic "particle system in JS" shape and matches B7's nested baseline — comparing to the flat variant is out of scope for B8.
- `tick()` performs insert × K, remove × K, and iterate-all-occupied-and-mutate-pos.x. The iteration must walk the actual occupied set (either by traversing the FIFO queue window or by scanning the array and skipping nulls — builder picks, but it must iterate every currently-live entity exactly once per tick).
- `setup` fills to `INITIAL_FILL`, seeds the FIFO queue, and resets counters. `teardown` is a no-op.
- `warmupTicks`: 50.

**`b8RigidJs: SustainedScenario`**:
- `const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })` and `const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })`.
- `const s = slab(Particle, CAPACITY)` built in `setup`.
- FIFO queue of **slot keys** (returned by `insert().slot` or captured via `h.slot`) backed by `Int32Array(CAPACITY)`.
- `tick()` performs `insert()` × K capturing slot keys into the FIFO tail, `remove(fifo[head++])` × K for the head entries, and iterates every live slot to mutate `h.pos.x += h.vel.x * DT`. For iteration the builder may either walk the FIFO window (head..tail) or scan 0..capacity-1 using `s.has(i)` — whichever aligns with how the JS baseline walks its live set. Document the choice.
- `setup` fills to `INITIAL_FILL` and seeds the FIFO queue. `teardown` calls `s.drop()`.
- Handle reuse reminder: `s.get(i)` and `s.insert()` return the same handle instance rebased to the new slot. Do not hoist a handle above the loop.
- `warmupTicks`: 50.

**`allocate()` on both scenarios**: not required for B8 (B8 is a sustained-state scenario, not a one-shot allocation scenario — the insight comes from per-tick latency distribution, not peak pressure). Leave `allocate` undefined.

Export: `export const b8Scenarios: SustainedScenario[] = [b8JsBaseline, b8RigidJs]`.

**Key metrics for the report**: `p99TickMs`, `p999TickMs`, `maxTickMs`, `stdDevTickMs`. Mean and p50 are reported for context but the point of B8 is the **tail**.

### 3. `benchmark/scenarios/b9-heap-scaling.ts` — B9

Create `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b9-heap-scaling.ts`.

**Constants at the top of the file**:

```ts
const PER_CAPACITY_DURATION_MS = 2_000
const CAPACITIES: readonly number[] = [10_000, 100_000, 1_000_000]
const XL_CAPACITY = 10_000_000
const CHURN_RATIO = 0.01  // 1% of capacity churned per tick
const DT = 0.016
```

The workload is **the same shape as B8** — insert K, remove K (FIFO), iterate-and-mutate — but with K = `Math.floor(capacity * CHURN_RATIO)` so the per-tick work scales proportionally with capacity. Initial fill is always 50% of capacity.

**Export two scenario factories**:

- `b9JsBaselineFactory: (capacity: number) => SustainedScenario` — same JS baseline shape as B8 (array + nested entity + free-list + FIFO), sized to `capacity`.
- `b9RigidJsFactory: (capacity: number) => SustainedScenario` — same slab-backed shape as B8, `slab(Particle, capacity)`.

Each factory returns a `SustainedScenario` with `durationMs: PER_CAPACITY_DURATION_MS` and `warmupTicks: 25`. Naming convention: `\`b9-js-cap${capacity}\`` and `\`b9-rigid-cap${capacity}\``.

**XL gating**: `benchmark/run.ts` reads `process.env.RIGIDJS_BENCH_XL`. If truthy (`"1"` or `"true"`), append `XL_CAPACITY` to the capacities list before passing to `benchScaling`. Otherwise run only `CAPACITIES`. Document this flag in the benchmark.md report.

Export: `b9JsBaselineFactory`, `b9RigidJsFactory`, `CAPACITIES` (as a const), and `XL_CAPACITY` (as a number).

### 4. `benchmark/run.ts` — extend entry runner

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`. The file currently runs B1/B2/B3/B7 and writes to `.chief/milestone-2/_report/task-7/`. Leave that flow **byte-for-byte unchanged** — same `runAll` call, same `formatTable` print, same writes to the task-7 report files.

**Append** the following after the existing flow:

1. Import `benchSustained`, `benchScaling`, `formatSustainedTable`, `SustainedResult` from `./harness.js`.
2. Import `b8Scenarios` from `./scenarios/b8-sustained-churn.js`.
3. Import `b9JsBaselineFactory`, `b9RigidJsFactory`, `CAPACITIES`, `XL_CAPACITY` from `./scenarios/b9-heap-scaling.js`.
4. Run B8: iterate `b8Scenarios` and call `benchSustained` for each, collecting results. Between scenarios call `Bun.gc(true)` + `await Bun.sleep(100)`.
5. Run B9: build the capacity list (append `XL_CAPACITY` if `process.env.RIGIDJS_BENCH_XL` is truthy), then call `benchScaling(b9JsBaselineFactory, capacities)` and `benchScaling(b9RigidJsFactory, capacities)` in sequence. Collect both result arrays into a flat `b9Results: SustainedResult[]`.
6. Print a separator line and `console.log(formatSustainedTable([...b8Results, ...b9Results]))` to stdout. The existing per-op table is still printed first; the new sustained table appears below it.
7. Write `.chief/milestone-2/_report/task-9/results.json` via `Bun.write`. Shape:

   ```json
   {
     "meta": { "bunVersion": "...", "platform": "...", "arch": "...", "date": "ISO8601", "xlEnabled": false },
     "b8": [ SustainedResult, ... ],
     "b9": [ SustainedResult, ... ]
   }
   ```

   Create the directory recursively if it does not exist (use `import { mkdir } from 'node:fs/promises'` with `{ recursive: true }`, matching the task-7 pattern).

8. Write `.chief/milestone-2/_report/task-9/benchmark.md`. Contents:
   - Top matter: bun version, platform/arch, date, `xlEnabled` flag.
   - **Introduction** (must include): why B8/B9 exist. State the task-7/task-8 finding plainly — RigidJS allocates ~300x fewer GC-tracked objects but is ~2.6x–6.2x slower on raw per-op throughput at 10k–100k scales with a warm JIT. The thesis is "your app stops pausing", not "tight loops run faster". B8 and B9 test whether the allocation-pressure win translates into lower p99 tick latency and better scaling under sustained workloads. State upfront that the task succeeds if the experiment runs and reports the truth — the task does not require RigidJS to win.
   - **## B8 — Sustained churn (10s, 100k capacity, 1k churn/tick)** section with a table showing `name`, `ticksCompleted`, `meanMs`, `p50Ms`, `p99Ms`, `p999Ms`, `maxMs`, `stdDevMs`. 2–4 sentences of interpretation anchored on the p99 / tail behavior. Call out whether RigidJS or JS has the flatter tail, by how much, and whether the max-tick (GC spike) is visibly larger for one variant.
   - **## B9 — Heap-pressure scaling curve** section with a table showing one row per (variant, capacity) pair: `variant`, `capacity`, `ticksCompleted`, `meanMs`, `p99Ms`, `maxMs`. 2–4 sentences of interpretation: does JS p99 grow as heap grows? Does RigidJS stay flat? If XL was enabled, note that row specially. If XL was not enabled, add one line stating how to enable it (`RIGIDJS_BENCH_XL=1 bun run bench`) and noting the ~600MB memory budget for the 10M run.
   - **## Verdict** section — an honest plain-language reading. Three possible outcomes:
     1. **Thesis supported**: RigidJS p99/p999 stays meaningfully lower than JS under sustained load and/or scales better with heap size. Report the specific ratios.
     2. **Thesis partially supported**: mean/p50 still lose to JS (expected, consistent with task-7) but p99/p999/max show RigidJS winning on tail — which is the thesis.
     3. **Thesis not supported by this data**: if DataView dispatch cost dominates the GC pause savings at these capacities, say so. Name which scenarios it happens in. Speculate cautiously on what a different scale or workload might show. Do not cook the numbers.
   - **## Caveats** block: single-run numbers are noisy, GC behavior is non-deterministic between runs, benchmarks were measured on a specific bun version and machine. Point at `results.json` for raw data.
   - Final line: reference to `.chief/milestone-2/_report/task-9/results.json`.

9. Exit code: `process.exit(0)` on success. Uncaught exceptions surface naturally.

**Backwards compatibility** the builder must verify:
- The existing task-7 stdout table still prints first, byte-for-byte the same columns and ordering. The sustained table appears strictly below it, separated by a blank line and a header like `--- Sustained scenarios (B8/B9) ---`.
- The task-7 results.json and benchmark.md still get written, unchanged in structure from task-8's output.
- Running `bun run bench` with no env vars completes in under ~90 seconds wall time on a developer laptop. Budget: ~20s existing + ~20s B8 (10s × 2) + ~12s B9 (2s × 3 × 2) + GC/warmup/report overhead ≈ ~60s worst case, with ~30s slack.

### 5. Probe-verify the new scenarios with live numbers

After the edits, run `bun run bench` once and inspect the new `.chief/milestone-2/_report/task-9/results.json` and `benchmark.md`. The builder must **not** declare the task complete if the probe-verify numbers come back obviously wrong. Sanity checks:

- `b8Results[*].ticksCompleted` ≥ 100 for both variants. (If ticks are fewer than 100 in 10 seconds, something is pathologically wrong — either the tick is taking 100+ ms, the buffer is being resized mid-loop, or the time budget is misinterpreted.)
- `b8Results[*].ticksCompleted` ≤ `Math.ceil(10_000 * 2)` — i.e. the pre-sized buffer cap. (If the buffer is overflowing, the harness should have thrown, not silently truncated.)
- `b8Results[*].p50TickMs` is a positive finite number ≤ 500 for both variants.
- `b8Results[*].p99TickMs ≥ p50TickMs` (basic sanity on the percentile math).
- `b8Results[*].maxTickMs ≥ p999TickMs ≥ p99TickMs`.
- For B9, all three capacity rows exist for both variants (6 total without XL); each row has `ticksCompleted ≥ 20` (conservative floor for 2s runs).
- Neither `bun run typecheck` nor `bun test` regresses.
- `.chief/milestone-2/_report/task-7/` files have not been rewritten (check `git diff --stat` — only timestamps may differ from a re-run of task-7's portion of the flow, and content should be equivalent).

If any sanity check fails, the builder must stop, investigate, and fix — not ship the broken numbers.

## Acceptance Criteria

- [ ] `bun run bench` exits 0 within ~90 seconds wall time with no env vars
- [ ] `bun run bench` prints the existing per-op table first, unchanged, then prints a `--- Sustained scenarios (B8/B9) ---` separator and a sustained-results table below it
- [ ] `.chief/milestone-2/_report/task-9/results.json` exists, parses as valid JSON, and contains `meta`, `b8`, and `b9` top-level keys
- [ ] `results.json` `b8` array contains 2 entries (JS baseline + RigidJS), each with all `SustainedResult` fields populated (no `null` in `ticksCompleted`, `meanTickMs`, `p50TickMs`, `p99TickMs`, `p999TickMs`, `maxTickMs`, `heapSizeMB`, `rssMB`; `allocationDelta` is `null` since B8 has no `allocate()`)
- [ ] `results.json` `b9` array contains 6 entries without XL (3 capacities × 2 variants), or 8 entries with `RIGIDJS_BENCH_XL=1`. Every entry carries a numeric `capacity` field matching one of `CAPACITIES` / `XL_CAPACITY`.
- [ ] `.chief/milestone-2/_report/task-9/benchmark.md` exists and contains Introduction, `## B8`, `## B9`, `## Verdict`, and `## Caveats` sections, plus a pointer to `results.json`
- [ ] `.chief/milestone-2/_report/task-7/results.json` and `.chief/milestone-2/_report/task-7/benchmark.md` are NOT modified by task-9 (their content matches the post-task-8 state; only file mtimes may change if the task-7 flow re-runs, but `git diff` on the content must be empty)
- [ ] `bun test` still exits 0 with all 155 prior tests green
- [ ] `bun run typecheck` exits 0 and includes `benchmark/scenarios/b8-sustained-churn.ts` and `benchmark/scenarios/b9-heap-scaling.ts`
- [ ] `bun run examples/particles.ts` still prints the same deterministic four-line summary from task-6
- [ ] `grep -rn "Proxy" src/` returns zero matches (sanity check that `src/**` is untouched)
- [ ] `grep -rn "from '.*src/struct\|from '.*src/slab" benchmark/` returns zero matches (no deep imports)
- [ ] `grep -rn "heapStats().objectCount" benchmark/` returns zero matches — the benchmark harness uses only `liveObjectCount(heapStats())` from task-8
- [ ] `grep -rn "benchmark" tests/` returns zero matches (benchmarks are not tests)
- [ ] `git diff --stat -- src/ tests/ examples/ package.json tsconfig.json CLAUDE.md .chief/_rules/ .chief/milestone-2/_contract/ .chief/milestone-2/_goal/ .chief/_template/` prints nothing
- [ ] Existing `bench`, `runAll`, `formatTable`, `BenchResult`, `Scenario` exports from `benchmark/harness.ts` are unchanged in name, signature, and behavior
- [ ] The new `benchSustained`, `benchScaling`, `formatSustainedTable`, `SustainedScenario`, `SustainedResult`, and the extracted `liveObjectCount` are exported from `benchmark/harness.ts`
- [ ] Probe-verify sanity checks from §5 all pass
- [ ] The per-tick latency buffer in `benchSustained` is a pre-sized `Float64Array`, not an `Array<number>`; no `.push()` in the timing loop
- [ ] The runaway-tick guard (3x duration ceiling) is present and reachable — builder confirms by temporarily injecting an intentionally hung tick, running, confirming the clear error message fires, then removing the injection
- [ ] Neither B8 nor B9 scenarios use `any` or `unknown` in exported signatures except where the task-8 rule permits (`SustainedScenario.allocate` return type)
- [ ] Neither B8 nor B9 scenarios hoist a handle above a `for` loop inside `tick()` — every `insert()` and `get(i)` is called inside the loop body

## Out of Scope (Explicit)

- Regression gates, CI thresholds, multi-run averaging, statistical significance tests
- Fixing task-7/task-8's ops/sec measurements (they are honest)
- Adding scenarios B4/B5/B6 (require `.iter()`, `bump()`, `vec()` — future milestones)
- Profiling integration (`--heap-prof`, Chrome DevTools, bun:jsc DFG counters beyond `heapStats()`)
- Graph/plot rendering (text table output is sufficient; chart rendering, if ever wanted, is a new task)
- Parallel benchmarks across worker threads
- Changing the existing B1/B2/B3/B7 scenario numbers, output format, or report location
- Editing the task-7/task-8 reports (task-9 gets its own `.chief/milestone-2/_report/task-9/` directory)
- Editing `src/**`, `tests/**`, `examples/**`, `package.json`, `tsconfig.json`, `CLAUDE.md`, the design spec, or anything under `.chief/_rules/**` / `.chief/milestone-2/_contract/**` / `.chief/milestone-2/_goal/**`
- Adding new dependencies of any kind
- Adding `allocate()` to B8 or B9 scenarios (they are sustained-state scenarios, not peak-allocation scenarios)
- `Map<number, Entity>` as the JS baseline for B8/B9 (see Design Notes §JS baseline choice)

## Design Notes

### Why per-tick metrics matter more than per-operation for sustained scenarios

Per-operation averaging hides GC pauses. A 100ms stop-the-world GC that happens once in 100,000 operations is invisible in an ops/sec number but is catastrophic for a 60 Hz game loop, a real-time UI, or an HTTP request handler — the one tick where GC fires blows through the frame budget and the user sees a stall. The right way to measure "does my app pause?" is to measure **per-tick latency distribution** — specifically p99, p999, and max — so the rare GC event becomes visible as a tail spike. Mean and p50 still mostly reflect the happy path (DataView dispatch cost for RigidJS, JIT-inlined access for plain JS), and we expect plain JS to win on those at the capacities B8/B9 probe. The thesis is about the tail.

### Why fill to 50% before the measurement window

An empty container gives the garbage collector nothing meaningful to scan. The collector walks live heap to find roots and trace references; with no heap state, the mark phase is effectively free. To actually exercise GC cost we need the heap to contain a non-trivial population of live objects before the measurement starts. 50% of capacity is a reasonable steady-state for a particle system, entity store, or event queue — enough objects for GC to actually work on, not so full that churn immediately forces reallocation in the JS baseline.

### JS baseline choice (B8/B9)

The JS baseline is **`Array<Entity | null>` + numeric free-list + FIFO queue**, not `Map<number, Entity>` and not raw `push`/`splice`.

- `Map<number, Entity>` has per-entry GC overhead that is an unrelated confounding variable — we would end up measuring `Map` bucket churn rather than the object-layout cost the benchmark is trying to isolate.
- Raw `push`/`splice` on an unbounded array has O(n) remove semantics and triggers array reallocation, which both unfairly penalizes the baseline and turns the benchmark into a data-structure comparison rather than a memory-layout comparison.
- A pre-sized array with a numeric free-list mirrors slab's internal structure (bitmap + free-list), so the remaining delta between the two variants is **purely** about per-entity allocation and layout — which is exactly what RigidJS's thesis is about.

This is the same rationale B2 uses (see task-7 Notes §JS baseline choices). B8/B9 reuse that choice for consistency and fairness.

Entity shape is **nested** (`{ pos: { x, y, z }, vel: { x, y, z }, life, id }`) because that is the idiomatic JS shape and matches how B7's nested baseline measured ~150k objects per 50k entities. A flat-baseline variant (like B7 has) is out of scope for B8/B9 — the point of these scenarios is sustained p99, not peak allocation count, and adding more variants would explode the runtime budget without adding insight.

### Why B9's 10M-capacity run is optional

A 10,000,000-slot `Particle` slab allocates roughly 600 MB of backing storage (56 bytes per `Particle` × 10M, plus bitmap overhead). The JS baseline at the same capacity allocates ~10M plain objects, which on v8/JSC is on the order of hundreds of megabytes of heap and tens of millions of GC-tracked entries. On a 16 GB developer laptop this can either OOM, swap heavily, or dominate wall-clock time with GC. Gating XL behind an env var (`RIGIDJS_BENCH_XL=1`) keeps local dev runs fast while letting users with headroom explicitly opt in to the extreme-scale test.

### Per-tick latency precision

Tick latencies can legitimately span a wide dynamic range. An easy B8 RigidJS tick might be ~0.5 ms; a JS tick with a GC fire might be 50+ ms. The harness must use nanoseconds internally (`Bun.nanoseconds()`) and format ms output to **4 decimal places** so that sub-millisecond p50 values are not rounded to zero. `meanTickMs.toFixed(4)` is the right approach for the markdown table.

### Honest reporting — the task succeeds even if RigidJS loses

There is a real possibility that DataView dispatch cost dominates the GC pause savings at the scales B8/B9 probe. In that case, RigidJS's per-tick p99 could be **worse** than the JS baseline's, not better — because every tick pays the DataView tax, while the JS baseline only pays the GC tax on the rare ticks when GC actually fires, and most ticks run in JIT-inlined hot-path mode. If that is what the data shows, **the task still succeeds**. The deliverable is "run the experiment and report the truth", not "prove RigidJS wins". The benchmark.md Verdict section must be written honestly based on whatever numbers come out. The point of benchmarks is to calibrate reality against thesis, not to confirm bias.

### Phase ordering inside `benchSustained()`

The allocation phase (if `allocate` is defined) and the sustained timing phase share one `setup()` call at the top and one `teardown()` call at the bottom. For B8 and B9, `allocate` is **not** defined — the scenarios are pure sustained-state workloads and the allocation-pressure story was already told by B1/B7 in task-7/task-8. Leaving `allocate` out means the harness skips the allocation phase entirely and reports `allocationDelta: null`, which is correct.

### Handle reuse reminder (RigidJS tick body)

Inside the RigidJS `tick()` body, every `s.get(i)` call returns the same handle instance rebased to slot `i`. Assigning to `h.pos.x` mutates the underlying buffer at slot `i`'s offset — exactly what the scenario wants. Do not hoist `const h = s.get(i)` outside the iteration loop; that would pin it to one slot. Same rule as B3.

### Import path convention

Benchmark files under `benchmark/scenarios/` import from `'../../src/index.js'` (two-dot-two-dot). The scenario files under `benchmark/scenarios/` also import types from `'../harness.js'` (one-dot-dot, matching the existing B1/B2/B3/B7 files). `verbatimModuleSyntax` is on so `.js` extensions are required. Do not deviate.

### Timing-loop invariance for existing scenarios

The extraction of `liveObjectCount` from inline into a named helper must not regress B1/B2/B3/B7 timing. After the edits, B2 `p99Us`, B3 `opsPerSec`, and B1/B7 `allocationDelta` values should land within normal run-to-run variance of the task-8 baseline. If any regress by more than ~20%, something in the harness changed that it should not have — investigate before shipping.

### Anti-DCE for sustained `allocate()` path

If B8/B9 ever do add an `allocate` method (they currently do not, by design), the same anti-DCE rule from task-8 applies: declare `retained` as a wide-scoped `let`, add an explicit `void retained` between the second `heapStats()` sample and the `retained = null` line, and comment the `void retained` with a one-line note about JIT DCE. Since B8/B9 as specified do not use `allocate`, this is informational only — relevant if a future task adds it.

## Verification Commands

```bash
bun run bench
bun test
bun run typecheck
bun run examples/particles.ts
cat .chief/milestone-2/_report/task-9/results.json | head -40
cat .chief/milestone-2/_report/task-9/benchmark.md | head -60
cat .chief/milestone-2/_report/task-7/benchmark.md | head -20
grep -rn "Proxy" src/
grep -rn "benchmark" tests/
grep -rn "from '.*src/struct\|from '.*src/slab" benchmark/
grep -rn "heapStats().objectCount" benchmark/
git diff --stat -- src/ tests/ examples/ package.json tsconfig.json CLAUDE.md .chief/_rules/ .chief/milestone-2/_contract/ .chief/milestone-2/_goal/
```

Expected results for each command are listed in the Acceptance Criteria above. The last `git diff --stat` must print nothing (empty diff across the protected paths).
