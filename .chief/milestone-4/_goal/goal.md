# Milestone 4 Goal — Phase 1c: `vec()` Growable Container + Slab Free-List Optimization

## Objective

Ship `vec(def, initialCapacity?)` as a growable, ordered, densely-packed container that reuses the SoA + TypedArray infrastructure from milestone-3. Vec eliminates the bitmap, free-list, and occupancy-branching overhead that limits slab performance on ordered workloads. Add `swapRemove(index)` for O(1) unordered removal, `remove(index)` for O(n) order-preserving removal, and native `for..of` iteration. As a secondary deliverable, replace the slab's JS Array free-list with a pre-allocated `Uint32Array` stack to reduce GC pressure during churn. Benchmark all new scenarios against plain JS and slab baselines with honest reporting.

Reference material:
- `.chief/_rules/_goal/rigidjs-design-spec-v3.md` -- section 4.3 (vec spec)
- `.chief/milestone-3/_report/improvement-suggestions.md` -- Option A analysis
- `.chief/milestone-3/_report/task-4/benchmark.md` -- current perf baseline
- `.chief/milestone-3/_contract/public-api.md` -- milestone-3 contract to extend

## In Scope

1. **`vec(def, initialCapacity?)` container** with push/pop/get/len/capacity/clear/drop/buffer/column and `Symbol.iterator`.
2. **`swapRemove(index)`** -- O(1) removal by swapping with last element. Order changes.
3. **`remove(index)`** -- O(n) removal by shifting elements left via `copyWithin`. Order preserved.
4. **Growth strategy** -- 2x capacity doubling on push overflow. Column copy via `TypedArray.set()`. Default initial capacity: 16.
5. **`for..of` iteration** -- yields shared handle rebased to each index 0..len-1. Single iterator object allocation per loop. Handle reuse invariant same as slab.
6. **Column access** -- `vec.column(name)` returns pre-built TypedArray view. Refs invalidate on growth.
7. **Handle reuse** -- same shared-handle invariant as slab. push/get/iterator all return the same handle instance.
8. **Public API wiring** -- re-export `vec` and `Vec` from `src/index.ts`.
9. **Slab free-list optimization** -- replace JS `Array` free-list with `Uint32Array` stack pointer in `src/slab/slab.ts`.
10. **New benchmark scenarios** -- B1-vec, B2-vec, B3-vec-handle, B3-vec-column, B3-partial (50%-full slab vs vec).
11. **Benchmark report** -- standard format with What This Means For You, slab vs vec vs JS comparison, honest assessment.

## Out of Scope (Deferred)

- `.iter()` lazy chain (filter/map/take/reduce) -- milestone-5
- `bump()` arena allocator -- milestone-5+
- String field types (`str:N`, `string`) -- Phase 2
- `slab.forEach()` -- milestone-5
- `for..of` on slab -- milestone-5 (requires occupancy-checking iterator logic)
- CI pipeline / regression gates
- npm publish
- Lint / format tooling

## Success Criteria

### Hard floors (must not regress -- block the milestone)

- [ ] All existing tests pass (263+ from milestone-3). Total test count does not decrease.
- [ ] `bun test` exits 0 with zero failing tests.
- [ ] `bun run typecheck` exits 0 with zero errors.
- [ ] `bun run examples/particles.ts` produces identical deterministic output (slab-based example unchanged).
- [ ] Zero public API removals or renames from milestone-3. All existing slab/struct symbols preserved.
- [ ] `slab.buffer` still returns a single `ArrayBuffer`.
- [ ] Zero runtime dependencies. `package.json` `dependencies` stays empty.
- [ ] No `Proxy` anywhere.
- [ ] No `/tmp` scripts. All benchmark probes/utilities under `benchmark/`.
- [ ] No regressions on slab benchmark scenarios (B1, B2, B3, B7, B8 ratios within noise of milestone-3 baseline).
- [ ] B8 max-tick (slab) stays at p99 <= 1ms.
- [ ] B1 slab allocationDelta <= 1000 (preserve GC win).
- [ ] B7 slab allocationDelta <= 1000.
- [ ] All vec GC object counts <= 1000 per container.

### Aspirational targets (report honestly, do not block)

| Scenario | Target |
|---|---|
| Vec push 100k (B1-vec) | >= 0.50x JS |
| Vec handle iteration (B3-vec-handle) | >= 0.90x JS |
| Vec column iteration (B3-vec-column) | >= 2.5x JS |
| Vec swapRemove churn (B2-vec) | >= 0.80x JS |
| B3-partial (50% full): vec vs slab | vec >= 1.5x slab |
| Slab B2 after free-list fix | >= 0.80x JS |
| All tail latency metrics | no regression from milestone-3 |

Report numbers honestly. Do not block the milestone on hitting aspirational ratios.

## Non-Negotiables

1. **Vec reuses milestone-3 SoA infrastructure.** `computeColumnLayout()`, `generateSoAHandleClass()`, `ColumnKey<F>`, `ColumnType<F, K>` -- all reused as-is. Only new code is container logic.
2. **Single `ArrayBuffer` per vec** (at any point in time). Growth allocates a new buffer and releases the old one.
3. **Zero allocations on handle field get/set.** Same monomorphic TypedArray indexed access as slab.
4. **Zero allocations per iterator `next()` call.** The iterator reuses one handle instance.
5. **Preserve all slab GC wins.** Slab benchmark results must not regress.
6. **Preserve all slab tail-latency wins.** B8 slab p99 <= 1ms.
7. **No new runtime dependencies.**
8. **Benchmark code uses only public API.** No deep imports into `src/struct/**`, `src/slab/**`, `src/vec/**`.
9. **No `/tmp` scripts.** All probes/utilities under `benchmark/`.
10. **`results.json` committed without time-series; `raw-timeseries.json` gitignored.**

## Decisions Deferred to Chief-Agent During Planning

- Whether handle column refs are updated in-place (mutable wrapper) or by re-creating the handle on growth. Builder-agent picks the simpler option and documents why.
- Whether `for..of` iterator is a generator function or a custom iterator object. Builder-agent decides.
- Whether the iterator object is cached on the vec instance or freshly allocated per `for..of` call. Builder-agent decides based on allocation budget analysis.
- Exact natural ordering of tasks within the milestone (answered in `_plan/_todo.md`).

## Status

Milestone-4 is planned. Tasks run in order: task-1 through task-5.
