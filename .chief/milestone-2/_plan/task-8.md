# Task 8 — Fix Allocation-Pressure Measurement in B1/B7

## Objective

Correct a measurement flaw in the task-7 benchmark harness: the allocation-pressure metric (`heapObjectsDelta`) for B1 and B7 currently measures **retained objects after a forced GC**, not **peak allocation pressure**. The task-7 run produced B1 JS baseline `heapΔ = +25` and B7 nested JS baseline `heapΔ = +9`, when the scenarios allocate 100,000 and 150,000 objects respectively. The fix adds an optional one-shot `allocate()` measurement phase to the harness that samples `heapStats()` before and after a single allocation call **without** forcing GC between the two samples, and keeps the allocated state reachable via a returned reference so it cannot be collected mid-measurement.

This task is purely additive to the benchmark suite. It must not touch `src/**`, `tests/**`, `examples/**`, `package.json` (no new deps), `tsconfig.json`, the design spec, `CLAUDE.md`, or any rules file. It must not change the `run()` timing methodology — B2/B3 throughput and p99 numbers are honest today and are not affected by the flaw.

## Inputs (read in order)

1. `/Users/thada/gits/thaitype/rigidjs/CLAUDE.md`
2. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/typescript.md`
3. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_standard/memory-and-perf.md`
4. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_verification/verification.md`
5. `/Users/thada/gits/thaitype/rigidjs/.chief/_rules/_goal/rigidjs-design-spec-v3.md` — §7.1 metrics, §7.2 harness, §7.3 scenarios
6. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_plan/task-7.md` — format reference and prior harness contract
7. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-7/benchmark.md` — prior results narrative
8. `/Users/thada/gits/thaitype/rigidjs/.chief/milestone-2/_report/task-7/results.json` — prior raw numbers showing the flaw
9. Existing benchmark source:
   - `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`
   - `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`
   - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b1-struct-creation.ts`
   - `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b7-nested-struct.ts`

## Scope Guardrails

- **Benchmark-only surface area.** All edits land under `benchmark/**` plus the updated reports under `.chief/milestone-2/_report/task-7/`. No edits anywhere else.
- **No edits to `src/**`, `tests/**`, `examples/**`, `CLAUDE.md`, `.chief/_rules/**`, `.chief/milestone-2/_contract/**`, the design spec, `tsconfig.json`, or `package.json`.** If the fix appears to require any of these, stop and escalate — do not work around it.
- **No new dependencies.** `package.json`'s `dependencies`, `devDependencies`, and `peerDependencies` stay byte-identical. No scripts added or renamed.
- **B2 and B3 are untouched.** Do not add `allocate()` to those scenarios, do not retime them, do not reinterpret them. Their p99 / ops/sec metrics are honest wall-clock measurements and are not affected by this fix.
- **Do not change the `run()` timing methodology.** Pre-sized `Float64Array` latency buffer, `Bun.nanoseconds()` bookends, warmup, inter-scenario GC, and the sort-then-p50/p99 routine all stay as-is.
- **TypeScript strict mode applies.** Zero `any` in exported signatures. The existing `Scenario` interface is extended with one optional method; no new cross-boundary type holes.
- **No hidden allocations in the measurement window.** Specifically, the `allocate()` phase between `heapBefore` and `heapAfter` must call exactly one user function and must not create intermediate arrays, closures, or strings that would muddy the delta.

## Deliverables

### 1. `benchmark/harness.ts` — extend `Scenario`, `BenchResult`, and `bench()`

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/harness.ts`:

- Extend the `Scenario` interface with one optional method:

  ```ts
  export interface Scenario {
    name: string
    setup: () => void
    fn: () => void
    teardown?: () => void
    iterations?: number
    warmup?: number
    /**
     * Optional one-shot allocation measurement. Called exactly once per
     * scenario. Must perform the full target allocation (e.g. 100k object
     * creations) and return a reference that keeps the allocated state
     * reachable so heapStats() can sample the live peak before anything is
     * collected. The harness samples heapStats() before and after this call
     * WITHOUT forcing GC in between.
     */
    allocate?: () => unknown
  }
  ```

- Extend `BenchResult` with two new fields, appended after `heapObjectsDelta`:

  ```ts
  export interface BenchResult {
    name: string
    opsPerSec: number
    heapObjectsBefore: number
    heapObjectsAfter: number
    heapObjectsDelta: number
    allocationDelta: number | null
    retainedAfterGC: number | null
    heapSizeMB: number
    rssMB: number
    p50Us: number
    p99Us: number
  }
  ```

- Modify `bench(scenario)` to perform an **allocation measurement phase before the existing warmup/timing phase** when `scenario.allocate` is defined. The phase runs in this exact order:

  1. Run `scenario.setup()` (unchanged — already required for the timing loop).
  2. Warmup `scenario.fn()` `warmup` times to keep JIT hot (this already happens; if the allocation phase runs first, leave the warmup where it is — see Notes §Phase ordering).
  3. Force `Bun.gc(true)` + `await Bun.sleep(100)` to get a clean slate.
  4. Sample `const heapBefore = heapStats()`.
  5. `let retained: unknown = scenario.allocate()` — exactly one call.
  6. Sample `const heapAfter = heapStats()` — **no GC, no sleep, no other work between steps 4 and 6**.
  7. Compute `allocationDelta = heapAfter.objectCount - heapBefore.objectCount`.
  8. Release the reference: `retained = null`, then `Bun.gc(true)` + `await Bun.sleep(100)`, then sample `const heapReleased = heapStats()`.
  9. Compute `retainedAfterGC = heapReleased.objectCount - heapBefore.objectCount`.

  When `scenario.allocate` is `undefined`, both `allocationDelta` and `retainedAfterGC` must be `null` in the returned `BenchResult` and this entire phase is skipped.

- **Critical anti-DCE requirement:** the `retained` local must not be optimized away. Assign it to a variable-scoped `let` declared outside the measurement so the JIT sees a live use, and add a `void retained` expression after step 6 and before step 8 to pin the reference through the second `heapStats()` sample. Do not log it, do not stringify it — logging could itself allocate.

- The existing timing loop (warmup, timed `fn()` iterations, pre-sized `Float64Array`, p50/p99, rss, etc.) is unchanged and runs **after** the allocation phase. Both phases share the same `setup()` / `teardown()` calls — `setup()` runs once at the top, `teardown()` runs once at the bottom, same as today.

- Update `formatTable()` to add two columns after `heapΔ`: `allocΔ` and `retained`. Render `null` as `-` (single dash, padded). Column widths may expand to fit. Header row and data rows must stay aligned.

- `bench` retains its `async function bench(scenario: Scenario): Promise<BenchResult>` signature; `runAll` is unchanged externally.

Type rules (unchanged from task-7):
- Explicit return types on exported functions.
- No `any` in exported signatures. `unknown` is allowed as the return type of `allocate` because scenarios legitimately return heterogeneous shapes (plain arrays, slabs, etc.).
- The `void retained` statement is the only place a local cast/discard is acceptable; comment it with one line explaining the anti-DCE purpose.

### 2. `benchmark/scenarios/b1-struct-creation.ts` — add `allocate()` to both scenarios

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b1-struct-creation.ts`:

- `b1JsBaseline`: add `allocate()` that constructs `const arr = new Array<{ x: number; y: number; z: number }>(100_000)`, fills every index with `{ x: i, y: i, z: i }`, and returns `arr`. The returned array keeps the 100,000 objects reachable for the `heapAfter` sample.
- `b1RigidJs`: add `allocate()` that builds `const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })`, `const s = slab(Vec3, 100_000)`, performs 100,000 `s.insert()` calls writing `x`, `y`, `z`, and returns `s`. Do **not** call `s.drop()` inside `allocate` — the harness needs the slab to remain live across the second `heapStats()` sample. The returned slab will be released by the harness's `retained = null`, and the slab's underlying `ArrayBuffer` is GC-managed so no explicit `drop()` is required for the measurement phase.

Both `fn` bodies (the iteration loop used for throughput) remain untouched. `setup` and `teardown` remain untouched. Export shape (`b1Scenarios`) remains unchanged.

### 3. `benchmark/scenarios/b7-nested-struct.ts` — add `allocate()` to all three scenarios

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/scenarios/b7-nested-struct.ts`:

- `b7JsNestedBaseline`: `allocate()` creates 50,000 objects shaped `{ pos: { x, y, z }, vel: { x, y, z }, life: 1, id: i }`, stores them in a pre-sized array, returns the array. Expected pressure: ~150,000 objects (50k parents + 50k `pos` + 50k `vel`).
- `b7JsFlatBaseline`: `allocate()` creates 50,000 objects shaped `{ posX, posY, posZ, velX, velY, velZ, life, id }`, stores them in a pre-sized array, returns the array. Expected pressure: ~50,000 objects.
- `b7RigidJs`: `allocate()` builds `const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })`, `const Particle = struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })`, `const s = slab(Particle, 50_000)`, performs 50,000 `insert()` calls writing every field (`pos.x`, `pos.y`, `pos.z`, `vel.x`, `vel.y`, `vel.z`, `life`, `id`), returns `s`. Expected pressure: a handful of engine-internal objects + one backing `ArrayBuffer` — **not** 50k and not 150k.

`fn`, `setup`, and `teardown` for all three scenarios are untouched. Export shape (`b7Scenarios`) remains unchanged.

### 4. `benchmark/run.ts` — extend the summary table and JSON output

Edit `/Users/thada/gits/thaitype/rigidjs/benchmark/run.ts`:

- The summary table printed to stdout now includes the two new columns (`allocΔ`, `retained`). This is handled by the updated `formatTable()` — `run.ts` just has to pass the results through.
- `results.json` at `.chief/milestone-2/_report/task-7/results.json` automatically gains the new fields since it serializes `BenchResult[]` directly. Confirm by opening the file after the run — every entry must contain `allocationDelta` and `retainedAfterGC`. Scenarios B2 and B3 will carry `null` for both fields; B1 and B7 will carry numbers.
- Rewrite `benchmark.md` at `.chief/milestone-2/_report/task-7/benchmark.md`:
  - Keep the existing scenario sections (`## B1`, `## B2`, `## B3`, `## B7`) and the Caveats block.
  - In the B1 and B7 sections, **drop any speculation about measurement flaws or GC timing** from the task-7 narrative.
  - Replace with a short interpretation grounded in the actual corrected numbers: how many objects the JS baseline allocates during one `allocate()` call, how many RigidJS allocates, and the ratio.
  - Add a one-line mention of the `retainedAfterGC` secondary metric where interesting (specifically: RigidJS should retain a constant small number regardless of slab size; JS baseline retention is driven by whether the returned reference is still live — since the harness drops it before the second GC, `retainedAfterGC` should be near zero for both, but any significant non-zero value is worth calling out).
  - B2 and B3 sections are unchanged except for any auto-regenerated table rows.

### 5. Probe-verify the fix with live numbers

After the edits, run `bun run bench` once and inspect the new `results.json` / `benchmark.md`. The builder must **not** declare the task complete if the probe-verify numbers come back near zero — that means the fix is wrong, not that RigidJS has the same allocation profile as plain JS. Expected live numbers:

- B1 JS baseline `allocationDelta` in the range [95_000, 110_000] (target ~100k, with slack for JSC engine-internal objects).
- B1 RigidJS `allocationDelta` ≤ 1_000 (realistic target: dozens).
- B7 nested JS baseline `allocationDelta` in the range [145_000, 160_000] (target ~150k).
- B7 flat JS baseline `allocationDelta` in the range [48_000, 55_000] (target ~50k).
- B7 RigidJS `allocationDelta` ≤ 1_000.

If any of these come back near zero (say `< 100` for a JS baseline), the builder must stop, investigate why the `retained` reference is being collected or why the second `heapStats()` sample is running against a GC'd heap, and fix it — not ship the broken numbers.

## Acceptance Criteria

- [ ] `bun run bench` exits 0
- [ ] Summary table printed to stdout includes `allocΔ` and `retained` columns, aligned with headers
- [ ] `.chief/milestone-2/_report/task-7/results.json` every entry contains `allocationDelta` and `retainedAfterGC` fields (number for B1 and B7, `null` for B2 and B3)
- [ ] B1 JS baseline `allocationDelta` ≥ 95_000
- [ ] B1 RigidJS `allocationDelta` ≤ 1_000
- [ ] B7 nested JS baseline `allocationDelta` ≥ 145_000
- [ ] B7 flat JS baseline `allocationDelta` ≥ 48_000
- [ ] B7 RigidJS `allocationDelta` ≤ 1_000
- [ ] `.chief/milestone-2/_report/task-7/benchmark.md` B1 and B7 sections are rewritten with interpretation based on the corrected `allocationDelta` numbers, with no leftover speculation about the measurement flaw
- [ ] `bun test` still exits 0 with all 155 prior tests green
- [ ] `bun run typecheck` exits 0
- [ ] `bun run examples/particles.ts` still prints the same four-line deterministic summary it printed after task-6/task-7
- [ ] `grep -rn "Proxy" src/` returns zero matches (sanity check that `src/**` was not touched)
- [ ] `git diff --stat` shows changes only under `benchmark/**`, `.chief/milestone-2/_report/task-7/**`, and `.chief/milestone-2/_plan/_todo.md` — no diffs in `src/`, `tests/`, `examples/`, `package.json`, or `tsconfig.json`
- [ ] `package.json` unchanged (no new deps, no script edits)
- [ ] B2 and B3 `allocationDelta` and `retainedAfterGC` are `null` in `results.json` (confirming their scenarios were not given an `allocate` method)
- [ ] `p99Us` for B2 and `opsPerSec` for B3 are within reasonable variance of the task-7 numbers (no regression introduced by the harness edits to the timing loop — see Notes §Timing-loop invariance)

## Out of Scope (Explicit)

- Sustained-load scenarios B8 and B9 (GC pause histograms, long-running churn) — those are task-9, planned after task-8 ships.
- Adding scenarios B4, B5, B6 — still gated on `.iter()`, `bump()`, and `vec()`.
- Regression gates, CI thresholds, multi-run averaging, statistical significance tests.
- External profiling tools (`--heap-prof`, instruments, `bun:jsc` internals beyond `heapStats()`).
- Editing `src/**`, `tests/**`, `examples/**`, `package.json`, `tsconfig.json`, the design spec, `CLAUDE.md`, or anything under `.chief/_rules/**` / `.chief/milestone-2/_contract/**`.
- Adding new dependencies of any kind.
- Changing the B2/B3 timing methodology or their JS baselines.
- Adding an `allocate()` method to B2 or B3 — they are throughput/latency scenarios, not peak-allocation scenarios.
- Renaming existing `BenchResult` fields or reordering `BenchResult` in a way that breaks JSON shape compatibility with task-7 consumers (new fields may only be appended).

## Notes

### Why forced GC between heapBefore and heapAfter breaks the measurement

The task-7 harness flow is: `Bun.gc(true)` → sample `heapBefore` → run `fn()` (which allocates 100k objects, then exits and loses all references as locals go out of scope) → `Bun.gc(true)` → sample `heapAfter`. Between the two samples the harness forces a GC. By the time `heapAfter` runs, every local reference from `fn()` has been collected. The resulting `heapObjectsDelta` reflects **only the objects retained past the forced GC**, which for a scenario that allocates transient locals is close to zero. The corrected flow skips the second GC **and** keeps the allocated state reachable via the returned `retained` reference, so `heapAfter` samples the live peak.

### Why `retainedAfterGC` is a useful secondary metric

After the allocation delta is captured, dropping `retained` and forcing GC gives us a separate datum: how much of the allocation actually survives a collection when the top-level reference is released. For RigidJS this should be approximately one `ArrayBuffer` plus a constant handful of bookkeeping objects, regardless of slab size — the slab itself is the only root, and when it is dropped the backing buffer is collectable. For the JS baseline this should also be near zero (since the harness has dropped the array reference before the second GC), but any non-trivial retention is worth flagging in `benchmark.md`.

### Why B2 and B3 do not get `allocate()`

B2 measures insert/remove churn latency (p99). B3 measures iteration throughput (ops/sec). Neither has a meaningful "peak allocation" metric: B2 is steady-state (allocations and frees balance each frame), and B3 allocates once in `setup()` and then only reads/writes existing memory in the timed loop. Adding `allocate()` to them would be meaningless and would clutter the report.

### Why inline measurement instead of external profiling

External tools (`--heap-prof`, Instruments, `bun:jsc` DFG counters) add dependencies on runtime flags and external viewers, fragment the results across formats, and complicate reproducibility. Inline `heapStats()` sampling keeps the benchmark self-contained: one command (`bun run bench`), one `results.json`, one `benchmark.md`, reproducible on any machine that can run Bun.

### `heapStats().objectCount` fluctuation

JSC's `heapStats()` includes engine-internal objects (compiled code, symbols, hidden classes) that fluctuate run-to-run by tens to low hundreds. That is why the acceptance criteria use generous lower bounds (`≥ 95_000` instead of `=== 100_000`) and why the RigidJS upper bounds are `≤ 1_000` instead of `≤ 10`. If the JS baseline `allocationDelta` comes in at `99_800` that is a pass; if it comes in at `47` that is a fail and the fix is wrong.

### Phase ordering

The allocation phase and the timing phase share one `setup()` call at the top and one `teardown()` call at the bottom. The allocation phase runs **before** the timing loop so that the large one-shot allocation does not pollute the JIT's view of the fn body being timed. Order inside `bench()`:

1. `setup()`
2. (if `allocate` present) allocation measurement phase — returns `allocationDelta`, `retainedAfterGC`
3. `Bun.gc(true)` + `await Bun.sleep(100)` to reset
4. Warmup `fn()`
5. `Bun.gc(true)` + `await Bun.sleep(100)`
6. Sample `heapBefore` (for the existing `heapObjectsDelta` field)
7. Timing loop
8. `Bun.gc(true)` + `await Bun.sleep(100)`
9. Sample `heapAfter`
10. `teardown()`
11. Compute and return `BenchResult`

The existing `heapObjectsDelta` field is preserved for backward compatibility and continues to measure what it measured in task-7 (post-GC retention around the timing loop). The new `allocationDelta` field is the honest peak-allocation metric.

### Timing-loop invariance

The timing loop must not regress. After the edits, B2 `p99Us` and B3 `opsPerSec` should be within normal run-to-run variance of the task-7 numbers. If they regress by more than ~20%, something in the harness changed that it should not have (for example, `teardown` being called in the wrong place, or an accidental extra GC inside the timing window). Investigate before shipping.

### Anti-DCE for the `retained` reference

JIT compilers aggressively eliminate dead code. If the harness writes:

```ts
const retained = scenario.allocate()
const heapAfter = heapStats()
// retained is never read again
```

the JIT is free to observe that `retained` is never read after `heapStats()` and mark the allocation as dead, potentially collecting it before `heapStats()` samples. The fix is to declare `retained` as a `let` scoped wide enough that the `retained = null` assignment in step 8 is a genuine use of the previous value, and to add an explicit `void retained` line between steps 6 and 8 with a one-line comment marking it as anti-DCE. That guarantees the reference is live through the second sample.

### Import path convention

Benchmark files import from `'../src/index.js'` (with the `.js` extension). `verbatimModuleSyntax` is on. Do not change this.

### Handle reuse reminder (RigidJS `allocate`)

In `b1RigidJs.allocate` and `b7RigidJs.allocate`, each call to `s.insert()` returns a handle rebased to the new slot; writes to `.x` / `.pos.x` / etc. go to that slot's offset in the backing buffer. This is the same pattern as the existing `fn` bodies from task-7 — follow the same style. Do not hoist a handle outside the insert loop.

## Verification Commands

```bash
bun run bench
bun test
bun run typecheck
bun run examples/particles.ts
cat .chief/milestone-2/_report/task-7/results.json | head -60
cat .chief/milestone-2/_report/task-7/benchmark.md | head -40
grep -rn "Proxy" src/
grep -rn "benchmark" tests/
git diff --stat -- src/ tests/ examples/ package.json tsconfig.json
```

Expected results for each command are listed in the Acceptance Criteria above. The last command must print nothing (empty diff across the protected paths).
