# TODO List for Milestone 4 -- vec() Growable Container + Slab Free-List Optimization

Tasks run strictly in order. Each task has a hard prerequisite on the one before it.

- [x] task-1: Vec core (fixed capacity) -- create `src/vec/vec.ts` with `vec()` factory, `Vec<F>` interface, push/pop/get/len/capacity/clear/drop/buffer/column. NO growth, NO swapRemove/remove, NO iterator. Tests for basic operations. This is the "slab but simpler" baseline with no bitmap and no free-list.
- [x] task-2: Growth + swapRemove + remove -- add ArrayBuffer reallocation on push overflow (2x doubling, column copy via TypedArray.set()), handle re-creation or ref update after growth, `swapRemove(index)`, `remove(index)` with `copyWithin`. Tests for growth correctness, swap semantics, order-preserving remove, column-ref invalidation after growth.
- [x] task-3: for..of iterator + public API wiring -- add `Symbol.iterator` on vec, re-export `vec` and `Vec` from `src/index.ts`, add a vec usage example under `examples/`. All existing tests pass. Full vec test coverage complete.
- [x] task-4: Slab free-list optimization -- replace JS `Array` free-list with `Uint32Array` stack in `src/slab/slab.ts`. Small, isolated change. All existing slab tests pass. Re-run slab benchmarks to confirm improvement.
- [x] task-5: Benchmark scenarios + final report -- add B1-vec, B2-vec, B3-vec-handle, B3-vec-column, B3-partial scenarios. Run full suite (slab + vec + JS). Write `.chief/milestone-4/_report/task-5/{results.json, benchmark.md}` with What This Means For You section and slab-vs-vec-vs-JS comparison. Write `milestone-4-summary.md`. Verify all hard floor gates.

**Note for builder-agents:** do NOT update this file yourselves. The human / chief-agent owns the checklist. Builder-agents finish their tasks and report back; chief-agent marks the box.
