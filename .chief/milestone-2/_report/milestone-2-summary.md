# Milestone 2 Summary

**Phase 1b: `slab()` core + benchmark evidence for the GC-pressure thesis.**

## What shipped

- `slab(def, capacity)` — fixed-capacity, slot-reusing container built on top of milestone-1's `struct()`
- Slot-key API: `insert() → Handle<F>`, `remove(slot)`, `has(slot)`, `get(slot)`, `handle.slot` (read-only getter)
- Fully-typed `Handle<F>` mapped type — users write `h.pos.x = 1.5` with zero casts
- `examples/particles.ts` — runnable end-to-end demonstration
- Benchmark suite comparing plain JS vs RigidJS (B1/B2/B3/B7 one-shot + B8/B9 sustained)
- 155 tests green, `tsc --noEmit` clean, zero runtime dependencies, zero `Proxy`

## The benchmark journey (task-7 → task-8 → task-9)

### Task-7 — First numbers, first doubts

Initial suite (B1 create, B2 churn, B3 iter+mutate, B7 nested). At first read, RigidJS looked strictly worse:

| | JS baseline | RigidJS |
|---|---:|---:|
| B1 create 100k (ops/s) | 795 | 251 |
| B3 iter+mutate 100k (ops/s) | 3,040 | 552 |
| B7 nested create (ops/s) | 856 | 235 |
| B1 heap objects Δ | **+25** | **−69** |
| B7 heap objects Δ | **+9** | **+50** |

Two problems mixed together: raw throughput genuinely lost (real), and the heap-objects-Δ numbers were nonsensical (wrong).

### Task-8 — Measurement flaw root-caused

The "before" and "after" `heapStats()` samples were both preceded by `Bun.gc(true)`, so transient allocations were collected before the second sample fired. But the deeper bug was that `heapStats().objectCount` is a **stale cached field** that only refreshes during a GC cycle. The live count lives in `heapStats().objectTypeCounts` (sum over all type entries). Task-8 added an additive `allocate()` phase to the harness, switched to the live sum, and re-ran. The corrected numbers:

| Scenario | JS allocated | RigidJS allocated | RigidJS advantage |
|---|---:|---:|---:|
| B1 — 100k Vec3 | 100,106 | **315** | **~318x fewer** |
| B7 — 50k nested Particle | 150,092 | **491** | **~306x fewer** |
| B7 — 50k flat Particle | 50,096 | **491** | **~102x fewer** |

This is the first real evidence for the RigidJS value proposition — two orders of magnitude fewer GC-tracked objects at identical semantics.

But throughput was still slower (DataView dispatch vs JIT-inlined property access), so the open question became: **does the GC-pressure reduction actually translate to user-visible wins?**

### Task-9 — Sustained load answers the question

Two new scenarios:
- **B8** — 10s wall-clock sustained churn at 100k capacity (1k insert + 1k remove + full iterate per tick, FIFO recycling)
- **B9** — Same workload at 10k / 100k / 1M capacities to trace the scaling curve

Results at the 100k sustained case (B8):

| Metric | JS baseline | RigidJS | Δ |
|---|---:|---:|---:|
| Ticks completed | 51,892 | 54,613 | RigidJS +5% |
| Mean tick (ms) | 0.193 | 0.183 | RigidJS 5% faster |
| p99 tick (ms) | 0.452 | 0.343 | **RigidJS 1.32x** |
| p999 tick (ms) | 0.929 | 0.635 | **RigidJS 1.46x** |
| Max tick (ms) | **18.31** | **5.79** | **RigidJS 3.2x** |

The 18ms max-tick for JS is the GC spike. RigidJS's worst tick is 5.8ms. Under sustained load at 100k, RigidJS wins on every tail-latency metric.

Scaling curve from B9 (max tick per variant):

| Capacity | JS max (ms) | RigidJS max (ms) | RigidJS advantage |
|---:|---:|---:|---:|
| 10k | 3.85 | **0.13** | **30x flatter** |
| 100k | 1.93 | **0.99** | 2x flatter |
| 1M | 7.10 | **5.56** | 1.3x flatter |

**RigidJS has a flatter tail at every capacity tested — even 10k where it loses on mean throughput 2x.**

## Honest limits

- **Mean throughput**: RigidJS is consistently slower on raw ops/sec at every tested scale. DataView dispatch cost is real per-operation. Workloads without latency SLAs that just grind numbers are strictly better in plain JS.
- **Small-capacity RSS**: at 10k capacity, RigidJS uses ~524MB vs JS ~134MB because the slab's fixed bookkeeping dominates when there's nothing to amortize. This inverts near 1M where JS RSS hits ~620MB and RigidJS stays at ~454MB.
- **B4/B5/B6 not runnable**: the spec scenarios for `.iter()` filter chains, `bump.scoped()` temp allocation, and `vec()` growth all require primitives that do not yet exist. Re-run the suite after those land.
- **Single machine, single run**: all numbers above are from one Apple M-series laptop on Bun 1.3.8. No statistical significance claims. Re-run before making positioning decisions.

## What the numbers mean for positioning

The pitch should NOT be "RigidJS runs faster than JS." It is:

1. **Two orders of magnitude less GC pressure** — measured, ~300x fewer objects the GC must scan per container.
2. **Flatter tail latency under sustained load** — measured, 3x better max-tick at 100k, 30x better at 10k.
3. **Predictable latency** — standard deviation and worst-case tick are both consistently lower for RigidJS.

The `.iter()`, `vec()`, and `bump()` primitives from future milestones should close the mean-throughput gap by amortizing DataView cost across bulk operations. That's the next test.

## Open questions for milestone-3+

- Does `.iter()` lazy-chain close the B3 iteration gap (currently JS 6.2x faster on mean)?
- Does `bump.scoped()` beat JS for transient allocation patterns (B5)?
- Do the numbers hold on non-Apple-Silicon hardware, under memory pressure, inside a long-running server?
- At what capacity does RigidJS start beating JS on **mean** throughput (not just tail)? Current data suggests somewhere >1M entities; B9 should be re-run at 10M to find out.

## Known measurement issues (deferred fixes)

### Task-10 JIT counter data is invalid — `numberOfDFGCompiles` was called wrong

Every `dfgΔ` / `ftlΔ` / `osrExitsΔ` column in `.chief/milestone-2/_report/task-10/benchmark.md` is `null`. Task-10 attributed this to a "Bun 1.3.8 limitation". **That attribution is wrong** — it is a harness measurement bug in `benchmark/probe-jsc.ts` and `benchmark/harness.ts`.

**Root cause.** `numberOfDFGCompiles` is a **per-function** counter with signature `numberOfDFGCompiles(fn: Function): number` — you pass it a specific function and it returns how many times JSC has DFG-compiled that function. Our probe and harness both called it with **zero arguments**, which returns `undefined`, which the `_probeCounter` helper interpreted as "counter unavailable".

**Repro proving the counter works on Bun 1.3.8:**

```ts
import { numberOfDFGCompiles } from 'bun:jsc'

const hot = (x: number) => x * x + x
for (let i = 0; i < 1_000_000; i++) hot(i)   // warm past DFG threshold
console.log(numberOfDFGCompiles(hot))         // → 1 (real number, not undefined)
```

**Other counters hit by the same bug.** Anything with a function-argument signature: `reoptimizationRetryCount`, `optimizeNextInvocation`, `noFTL`, `noInline`. All were misclassified as "unavailable" in task-10.

**Correct measurement strategy for the harness fix:**
1. Keep `scenario.fn` / `scenario.tick` as a top-level named `const` (already the case).
2. Before warmup, call `dfgBefore = numberOfDFGCompiles(scenario.fn)`.
3. Run warmup + measurement window as normal.
4. After the window, call `dfgAfter = numberOfDFGCompiles(scenario.fn)`.
5. Report `dfgCompilesDelta = dfgAfter - dfgBefore`.

This measures recompiles of the wrapper closure — a direct signal of "did the hot loop stay JIT-stable or did it thrash". **Blind spot:** it does NOT capture recompiles of nested functions called inside the wrapper (JSC tracks those separately per function). That blind spot should be documented when the fix lands; it does not block the correction.

**Also missed in task-10: `totalCompileTime()` delta.** This is a legitimately process-global counter (zero-arg, returns total ms JSC spent compiling since process start). The probe reported it as `0` at startup but the harness never sampled it as a delta across the measurement window. A full fix should capture `totalCompileTime()` before and after each run and report the delta alongside `dfgΔ`.

**Where the fix lives (when we get to it):**
1. Rewrite `benchmark/probe-jsc.ts` with a two-phase probe: phase A for zero-arg counters (existing), phase B for function-argument counters that passes a throwaway warmed function.
2. Rewire `benchmark/harness.ts` JIT counter sampling to pass `scenario.fn` / `scenario.tick` as the argument.
3. Add `totalCompileTime` delta sampling as a separate process-global signal.
4. Re-run `bun run bench` and overwrite `.chief/milestone-2/_report/task-10/{results.json, benchmark.md, bun-jsc-probe.txt}` with the corrected numbers. Task-7 and task-9 reports stay untouched.

**What's still valid in task-10 despite this bug.** CPU totals, high-water RSS, heap time-series sparklines, and per-tick latency percentiles are all unaffected by the JIT counter bug and remain trustworthy evidence.

**Status.** Fixed in milestone-3 task-1 (see `.chief/milestone-3/_plan/task-1.md`). The corrected harness passes `scenario.fn` / `scenario.tick` as the function argument to `numberOfDFGCompiles()`, `benchmark/probe-jsc.ts` now has a two-phase probe (zero-arg + function-arg), and `totalCompileTime()` delta sampling was added as a process-global secondary signal. The task-10 report was regenerated with real JIT data.

## Deliverables landed

- `src/slab/slab.ts`, `src/slab/bitmap.ts`, extended `src/struct/handle-codegen.ts`, `src/types.ts`
- `tests/slab/**`, updated `tests/struct/**`, updated `tests/public-api/**`
- `examples/particles.ts`
- `benchmark/harness.ts`, `benchmark/run.ts`, `benchmark/scenarios/b1-*`, `b2-*`, `b3-*`, `b7-*`, `b8-*`, `b9-*`
- `.chief/milestone-2/_report/task-4/acceptance.md` — original milestone-2 acceptance + task-5 amendment
- `.chief/milestone-2/_report/task-7/{results.json, benchmark.md}` — one-shot scenarios (corrected in task-8)
- `.chief/milestone-2/_report/task-9/{results.json, benchmark.md}` — sustained scenarios
- `.chief/milestone-2/_report/milestone-2-summary.md` — this file

## Status

Milestone-2 is complete. The `slab()` API is frozen. Benchmark baselines are recorded. Ready for milestone-3.
