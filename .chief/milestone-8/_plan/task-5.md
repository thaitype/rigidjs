# Task 5: Background Grow POC (SharedArrayBuffer + Worker)

## Objective

Write a standalone proof-of-concept script that tests the viability of using `SharedArrayBuffer` + `Worker` on Bun for background buffer growth. Measure copy speed and Worker message overhead. Produce a PASS/FAIL verdict for M9 planning.

**Independent of other tasks.** No changes to vec or slab.

## Scope

**Included:**
- Create `tmp/background-grow-poc.ts` (standalone Bun script)
- Test 1: Can a Worker copy a 100k-entity ArrayBuffer (e.g., 6 Float64 columns x 100k = 4.8 MB) faster than a blocking `TypedArray.set()` on the main thread?
- Test 2: What is the Worker `postMessage` round-trip latency? (send a message, Worker echoes back, measure elapsed)
- Test 3: Can `SharedArrayBuffer` be used with TypedArray views on Bun without issues?
- Write findings report to `.chief/milestone-8/_report/task-5/background-grow-poc.md`

**Excluded:**
- Any changes to `src/` code
- Any integration with vec grow or graduation
- Cross-runtime testing (Bun only)

## Rules & Contracts to Follow

- `.chief/_rules/_verification/verification.md` (typecheck not required for `tmp/` scripts)
- `CLAUDE.md`: no runtime dependencies

## Steps

1. Create `tmp/background-grow-poc.ts`:
   - Allocate a `SharedArrayBuffer` of ~5 MB (simulating 100k entities with 6 Float64 columns)
   - Create Float64Array views over it
   - Fill with test data
   - **Blocking copy benchmark:** Allocate a new ArrayBuffer at 2x size, copy via `TypedArray.set()`, measure with `Bun.nanoseconds()`
   - **Worker copy benchmark:** Create a Worker that receives the SharedArrayBuffer, allocates a new buffer, copies data, and posts back the new buffer. Measure total round-trip time.
   - **postMessage latency:** Measure 100 round-trips of a simple number message to establish baseline overhead.
   - Print results: blocking copy time, worker copy time, postMessage latency, verdict.

2. Run the script: `bun run tmp/background-grow-poc.ts`

3. Write findings to `.chief/milestone-8/_report/task-5/background-grow-poc.md`:
   - Raw numbers
   - Analysis: is the Worker copy time < blocking copy time + postMessage overhead?
   - Verdict: PASS (worth pursuing in M9) or FAIL (overhead too high)
   - Caveats and limitations

## Acceptance Criteria

- [ ] `tmp/background-grow-poc.ts` exists and runs with `bun run tmp/background-grow-poc.ts`
- [ ] Script measures: blocking copy time, worker copy time, postMessage latency
- [ ] Findings report exists at `.chief/milestone-8/_report/task-5/background-grow-poc.md`
- [ ] Report includes a clear PASS/FAIL verdict with reasoning
- [ ] No changes to `src/` directory

## Verification

```bash
bun run tmp/background-grow-poc.ts
# Script should complete without errors and print results
```

## Deliverables

- New: `tmp/background-grow-poc.ts`
- New: `.chief/milestone-8/_report/task-5/background-grow-poc.md`
