# Milestone 3 Goal — Phase 1b.2: SoA + TypedArray Handle Codegen

## Objective

Close the RigidJS mean-throughput gap against plain JS by rewriting the struct layout and handle code generation from single-`DataView` AoS access to single-`ArrayBuffer` **Structure-of-Arrays (SoA)** layout with **monomorphic TypedArray** handle accessors. Public API stays 100% compatible with milestone-2, with exactly one additive method: `slab.column(name)`. Preserve every tail-latency and GC-pressure win milestone-2 measured, fix the deferred JIT counter measurement bug from task-10 so the new codegen can be verified as monomorphic, and re-run the full benchmark suite with honest reporting.

Reference material:
- `.chief/_rules/_goal/rigidjs-design-spec-v3.md` — §4.1 (struct), §4.2 (slab), §6.1 (handle design), §7 (benchmarks)
- `.chief/milestone-2/_report/rigidjs-improvement-report.md` — root-cause analysis (§2.2 DataView overhead, §3.1 SoA, §3.3 column API, §3.4 monomorphic codegen)
- `.chief/milestone-2/_report/milestone-2-summary.md` — canonical task-7 → task-10 story including the JIT counter bug (§ "Known measurement issues (deferred fixes)")
- `.chief/milestone-2/_contract/public-api.md` — milestone-2 contract that milestone-3 MUST preserve byte-for-byte

## In Scope

1. **Single-buffer SoA layout.**
   - Exactly one `ArrayBuffer` per slab. `slab.buffer` behaviour is unchanged — same single underlying buffer.
   - Each flattened field gets a pre-built `TypedArray` sub-view into a slice of that buffer. The TypedArray subclass is chosen by the field's numeric token (`'f64'` → `Float64Array`, `'u32'` → `Uint32Array`, etc.).
   - Column order: field declaration order with a **natural-alignment sort** so each column's sub-view starts at an offset that is a multiple of its element size. Layout order: `f64` columns first, then `f32`/`u32`/`i32`, then `u16`/`i16`, then `u8`/`i8`. Within the same element-size bucket, original declaration order is preserved.
   - Nested struct fields are **flattened** into top-level columns with dotted internal keys: `pos.x`, `pos.y`, `pos.z`, `vel.x`, etc. Nested field access (`h.pos.x`) continues to work via pre-wired sub-handles that share the parent's `_slot`.
   - No padding bytes between columns — the alignment sort alone is sufficient to guarantee every `new <TypedArray>(buf, offset, length)` call succeeds.

2. **Monomorphic handle codegen.**
   - Each generated getter/setter captures a specific concrete TypedArray subclass directly. Getter body is `return this.<col>[this._slot]`; setter body is `this.<col>[this._slot] = v`.
   - No polymorphic `TypedArray[]` indirection. Each field's accessor reads from exactly one pre-resolved TypedArray reference captured in the handle's closure.
   - Nested struct fields still return pre-constructed sub-handles (zero allocation on access). Sub-handles share the parent's `_slot` via the existing `_rebase` recursion pattern, which is rewritten to carry column refs instead of `DataView + offset`.

3. **Handle rebase model.**
   - Internal handle shape changes from `{ _v: DataView, _o: number, _slot: number }` to a shape that holds per-column TypedArray references and `_slot`.
   - Public `handle.slot` getter is preserved and unchanged. Sub-handle `slot === 0` semantics are unchanged.
   - The `_rebase` method on the root handle continues to update `_slot` and recursively rebase sub-handles. Sub-handles rebase to the parent's new slot (same slot — SoA means they all index the same column array at the same index).

4. **Additive `slab.column(name)` API.**
   - Returns the pre-built TypedArray view for the named column in the flattened dotted-key namespace (`'pos.x'`, `'life'`, `'id'`, etc.).
   - Type-safe via new mapped types `ColumnKey<F>` and `ColumnType<F, K>` exported from the package. `ColumnKey<F>` flattens nested `StructDef<G>` fields into dotted keys; `ColumnType<F, K>` maps each key to its concrete TypedArray subclass.
   - Allocation-free on every call — the view is pre-built at slab construction and returned directly.
   - Mutations to the returned TypedArray are reflected via handle field access and vice versa (same underlying buffer).
   - Throws on unknown column names. Throws after `drop()`.

5. **Fix the task-10 JIT counter measurement bug (prerequisite).**
   - Rewrite `benchmark/probe-jsc.ts` to probe function-argument counters separately using a throwaway warmed function that returns a real numeric count.
   - Rewire `benchmark/harness.ts` to call `numberOfDFGCompiles(scenario.fn)` (and sustained equivalent) passing the actual hot function, sampling before warmup and after the measurement window.
   - Add `totalCompileTime()` delta as a process-global secondary signal.
   - Re-run `bun run bench` and **overwrite** `.chief/milestone-2/_report/task-10/{results.json, benchmark.md, bun-jsc-probe.txt}` with the corrected numbers. Update the correction block in `benchmark.md` to reflect the now-valid JIT data. `task-7` and `task-9` reports stay byte-identical.
   - This fix is required so milestone-3's gate checks can verify the new SoA codegen is actually monomorphic via real `dfgΔ` numbers.

6. **New benchmark scenario + full re-run.**
   - Add `benchmark/scenarios/b3-column.ts` — a B3-style iterate+mutate scenario that uses `slab.column('pos.x')` and `slab.column('vel.x')` directly in a pure TypedArray loop against the existing B3 plain-JS baseline.
   - Re-run the full suite (B1, B2, B3, B7, B8, B9 plus the new B3-column) under `bun run bench`.
   - Write the milestone-3 benchmark report to `.chief/milestone-3/_report/task-4/{results.json, benchmark.md}` in the same style as task-10, including a **What This Means For You** section that honestly frames the outcome for application developers.
   - Write `.chief/milestone-3/_report/milestone-3-summary.md` as the canonical milestone wrap.

## Out of Scope (Deferred)

- **`vec()`**, **`bump()`**, **`bump.scoped()`** — future milestones
- **`.iter()`** lazy chain (filter/map/take/etc.) — future milestone
- **`for..of slab`** iteration protocol — pairs with `.iter()`, future milestone
- **String field types** (`str:N`, `string`) — Phase 2
- **CI pipeline / regression gates** — future
- **Lint / format tooling** — future
- **Multi-threading / SharedArrayBuffer**
- **Any API rename or removal** — milestone-2 surface is frozen

## Success Criteria

### Hard floors (must not regress — block the milestone)

- [ ] All milestone-1 and milestone-2 tests still pass. Total test count does not decrease.
- [ ] `bun test` exits 0 with zero failing tests.
- [ ] `bun run typecheck` exits 0 with zero errors.
- [ ] `bun run examples/particles.ts` produces identical deterministic output to milestone-2.
- [ ] **B8 max-tick (RigidJS) stays ≤ 1ms** — tail-latency win from task-9 is preserved. (Task-9 baseline: 0.34ms RigidJS vs 5.21ms JS at 100k sustained churn.)
- [ ] **B1 allocation delta (RigidJS) stays ≤ 1000 live GC objects** — the ~315 number from task-8 is preserved (allow headroom for SoA's extra TypedArray views).
- [ ] **B7 allocation delta (RigidJS) stays ≤ 1000 live GC objects** — preserves the ~491 number from task-8.
- [ ] **Zero public API removals. Zero renames. Zero semantic changes** to any symbol listed in `.chief/milestone-2/_contract/public-api.md`. The only addition is `slab.column()`, `ColumnKey<F>`, `ColumnType<F, K>`.
- [ ] `slab.buffer` still returns a single `ArrayBuffer`. No multi-buffer escape hatch.
- [ ] Zero runtime dependencies still. `package.json` `dependencies` stays empty.
- [ ] No `Proxy` anywhere — grep confirms.
- [ ] No `/tmp` scripts created during any task. All benchmark probes/utilities live under `benchmark/` as committed files.
- [ ] Task-10 JIT counter fix produces a real non-zero `dfgΔ` for at least one warmed-up scenario function on the current Bun version, proving the bug is fixed.
- [ ] Milestone-3's SoA handles show stable (low or zero) `dfgΔ` on B3 iterate+mutate, proving the codegen is monomorphic and the JIT did not thrash on polymorphic shape changes.

### Aspirational targets (report honestly, do not block)

- [ ] B3 iterate+mutate mean throughput ratio: aim for **≥ 0.70x** plain JS (task-7 baseline 0.16x). If we land at 0.50x, ship it and report.
- [ ] B1 / B2 / B7 mean throughput ratios: aim for **≥ 0.60x** plain JS. Report whichever way the numbers land.
- [ ] B8 mean-tick ratio: stays **≥ 0.90x** plain JS (task-9 baseline ~parity).
- [ ] **New B3-column scenario ratio: ≥ 1.0x** plain JS on B3 mean throughput — proves SoA was worth it regardless of handle access cost. This is the "receipts" scenario.

Report numbers honestly. Do not block the milestone on hitting aspirational ratios — only the hard floors gate completion.

## Non-Negotiables

1. **Exactly one `ArrayBuffer` per slab.** The SoA rewrite uses pre-built TypedArray sub-views into that single buffer. Never allocate separate buffers per column.
2. **`slab.buffer` is unchanged.** Returns the same single `ArrayBuffer` it always did.
3. **Zero public API removals or renames.** Milestone-2 surface is frozen. Only `slab.column()` + `ColumnKey<F>` + `ColumnType<F, K>` are added.
4. **Zero allocations on handle field get/set.** Monomorphic TypedArray indexed access only. No closures, no dispatch tables, no indirection through an array of TypedArrays.
5. **Preserve the GC wins.** The ~300x fewer-tracked-objects result from task-8 must not regress past the ≤1000 hard floors.
6. **Preserve the tail-latency win.** B8 RigidJS max-tick ≤ 1ms.
7. **No new runtime dependencies.** Zero. Dev-only tooling is acceptable but discouraged for this milestone.
8. **Benchmark code uses only public API.** No deep imports into `src/struct/**` or `src/slab/**` from `benchmark/**`.
9. **No `/tmp` scripts.** Any probe, diagnostic, or utility needed during the milestone must live under `benchmark/` as a committed, typechecked file. Inherited from milestone-2/task-10, permanent.
10. **No edits to milestone-1 or milestone-2 files** with one exception: task-1 overwrites the three task-10 report artifacts (`results.json`, `benchmark.md`, `bun-jsc-probe.txt`) with corrected JIT counter data. Task-7 and task-9 reports stay byte-identical across the entire milestone.

### Acknowledged rule-override

`.chief/_rules/_standard/memory-and-perf.md` §Hard Rules #5 currently states "DataView only for mixed-type reads/writes" and #6 forbids reordering fields for alignment. Milestone-3 replaces the DataView strategy with monomorphic TypedArray columns and introduces a natural-alignment sort for column layout. This override was agreed with the human after the task-10 benchmark review and the rigidjs-improvement-report. The public-facing layout contract (declaration-order semantics, no padding observed externally) is preserved — the reorder is internal to column layout and invisible to users. Contract §Layout Rules in `.chief/_rules/_contract/public-api.md` continues to describe declaration order + no padding + nested-inline at the observable level (`sizeof` unchanged, dotted nested access unchanged). A future task may revise `memory-and-perf.md` and the global contract to reflect this shift; that revision is **not** in scope for milestone-3.

## Decisions Deferred to Chief-Agent During Planning

- Exact task split (answered in `_plan/_todo.md` — 4 tasks, optional task-5).
- Whether `ColumnKey<F>` / `ColumnType<F, K>` are exported from `src/index.ts` as named type exports or live only in `src/types.ts` (answer: export from `src/index.ts` so users can annotate column variables).
- Whether to keep the old `_v` / `_o` DataView codegen path alive during the transition (answer: task-2 adds the new path alongside the old one; task-3 cuts over and deletes the dead code in one atomic change).
- Whether to ship the optional TypedArray throughput probe as task-5 (answer: optional; include only if the chief-agent judges it worth the effort during execution).

## Status

Milestone-3 is planned. Builder-agent executes task-1 first (prerequisite), then task-2 → task-3 → task-4 in order. No task runs in parallel — each depends on its predecessor's deliverables.
