# Milestone 6: Performance Optimization Pass

## Objective

Close remaining throughput gaps identified in M5 benchmarks. No new features -- pure optimization and investigation.

## Targets

| Operation | Current ratio | Target |
|---|---|---|
| B3-vec indexed get(i) at N=100-1000 | 0.16-0.20x | Root-cause and fix if possible; document if JIT artifact |
| B3-vec/slab forEach | 0.85x / 1.13x | Investigate stride optimization to reach >=1.0x for vec |
| B2-vec churn (swapRemove) | 0.91x | Optimize column swap toward >=1.0x |

## Non-goals

- No new container types (bump allocator deferred to M7)
- No new public API surface
- No hybrid container work
- No string support

## Success criteria

1. Root cause of vec get(i) small-N collapse is identified and documented
2. forEach stride optimization is attempted; either lands or findings are documented
3. Vec churn optimization is attempted if budget allows
4. Full benchmark suite re-run with updated progress report

## Key constraint

All optimizations must pass existing tests (`bun test`) and type checks (`bun run typecheck`). No regressions in existing benchmark scenarios at N=100k.
