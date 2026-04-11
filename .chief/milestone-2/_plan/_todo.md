# TODO List for Milestone 2 — Phase 1b: `slab()` Core

- [x] task-1: Extend handle codegen with internal `_slot` field (constructor + `_rebase`) without breaking milestone-1
- [x] task-2: Internal bitmap + free-list primitives under `src/slab/` with full unit tests
- [x] task-3: `slab()` core implementation (insert/remove/get/has/len/capacity/clear/drop/buffer) with full test coverage
- [x] task-4: Public API wiring, `examples/particles.ts` acceptance run, and milestone-2 acceptance report
- [x] task-5: Slot-key amendment
- [x] task-6: Public type hardening — `Handle<F>` mapped type, `const F` generic, delete example shadow interfaces — `remove/has` take `number`, `handle.slot` public getter
- [x] task-7: Performance benchmark suite (B1/B2/B3/B7) comparing plain JS vs RigidJS
- [x] task-8: Fix allocation-pressure measurement flaw in B1/B7 (add one-shot `allocate()` phase to harness)
- [x] task-9: Sustained-load benchmarks B8 (time-budget churn) and B9 (heap-scaling curve) to test GC-pressure thesis under p99 tail latency
