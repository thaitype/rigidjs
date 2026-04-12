# Milestone-3 Improvement Suggestions

**Date:** 2026-04-12
**Context:** Written after milestone-3 (SoA rewrite) landed. All numbers reference milestone-3 benchmarks from `.chief/milestone-3/_report/task-4/benchmark.md`.

---

## 1. Current Scoreboard

| Scenario | RigidJS / JS | Status |
|---|---:|---|
| B3-column iter+mutate (100k) | **2.69x** | Wins |
| B8 sustained p99 (100k, 10s) | **2.7x better** | Wins |
| B8 sustained max-tick | **8.8x better** | Wins |
| GC object count (100k) | **~272x fewer** | Wins |
| B3 handle iter+mutate (100k) | 0.88x | Close, slightly behind |
| B2 insert/remove churn (10k) | 0.69x | Behind |
| B1 entity creation (100k) | 0.26x | Far behind |
| B7 nested entity creation (50k) | 0.26x | Far behind |

**Summary:** column iteration and tail latency win decisively. Handle iteration is near parity. Entity creation and churn are the remaining weak spots.

---

## 2. Root Cause of Remaining Gaps

### B1/B7 creation (0.26x JS)

`slab.insert()` per-call cost breakdown:

| Step | Operation | Cost source |
|---|---|---|
| 1 | Check `_dropped` flag | Negligible |
| 2 | `freeList.pop()` | **JS Array.pop()** — can trigger internal reallocation/GC |
| 3 | `bitmapSet(bits, slot)` | Bit arithmetic — cheap |
| 4 | Increment `_len` | Negligible |
| 5 | `_rebase(slot)` on shared handle | Updates `_slot` + recurses into sub-handles |
| 6 | Return handle | Negligible |
| 7 | User writes fields (`h.pos.x = v`) | `Float32Array[slot] = v` — fast |

The bottleneck is steps 2 and 5. The JS Array free-list is the primary overhead — `Array.pop()` and `Array.push()` on a 100k-element array have internal bookkeeping cost that compounds. The `_rebase` recursion adds function-call overhead per nested struct level.

**Comparison to plain JS:** `{ x: 1, y: 2, hp: 3 }` is a single object-literal allocation that the JIT optimizes into a hidden-class instantiation + 3 property stores. JSC has spent 15+ years making this fast. Matching it with slab.insert() is structurally difficult because slab does more work per entity (bitmap + free-list + rebase).

### B2 churn (0.69x JS)

Same free-list + bitmap overhead on both insert and remove. Each `remove(slot)` does: check dropped → validate range → check bitmap → clear bit → push to free-list → decrement len. The `Array.push()` on the free-list is the primary overhead.

### B3 handle iteration (0.88x JS)

The manual iteration pattern `for (i) { if (!has(i)) continue; get(i); ... }` has per-slot overhead:
- `has(i)`: bitmap check (cheap, but the function-call boundary costs)
- `get(i)`: rebase handle — sets `_slot`, recurses into sub-handles
- Branch: `if (!has(i)) continue` — unpredictable when slab is partially full

Plain JS iterates `array[i].pos.x` with a JIT-inlined hidden-class property access. No function calls, no branches for occupancy, no rebase.

---

## 3. Improvement Options (Ordered by Expected Impact)

### Option A — `vec()` container (new feature, highest impact)

**What it is:** a growable, ordered, contiguous container. Like slab but without holes — entities are packed from index 0 to `len-1`. Supports `push()` / `pop()` only (append to end, remove from end). No random removal. No bitmap. No free-list.

**Why it's faster than slab:**

| Overhead | slab | vec | Savings |
|---|---|---|---|
| Bitmap (occupancy tracking) | Uint8Array, checked on every has() | **None** — all slots 0..len are occupied | Eliminates has() entirely |
| Free-list (slot recycling) | JS Array with push/pop per insert/remove | **None** — push = advance pointer, pop = decrement pointer | Eliminates Array.push/pop overhead |
| Iteration branches | `if (!has(i)) continue` per slot | **None** — loop 0..len, every slot is live | Eliminates branch prediction misses |
| Rebase per iteration | `_rebase(slot)` with sub-handle recursion | Same (still needed) | No change |
| Growth | Fixed capacity, throws when full | **Doubles on overflow** — same as JS Array internals | More flexible, avoids over-allocation |

**Expected performance (vs plain JS):**

| Scenario | slab today | vec expected | Rationale |
|---|---:|---|---|
| Create 100k (B1-equiv) | 0.26x | **0.60–0.80x** | No free-list pop, no bitmap set. Just advance length pointer + field writes via TypedArray. Still slower than JS object literals because of per-field setter calls, but dramatically closer. |
| Iterate handle (B3-equiv) | 0.88x | **1.0–1.2x** | No has() check, no skip branches. Pure sequential loop 0..len with TypedArray[slot] access. Should match or beat JS because the JIT can predict the loop perfectly and TypedArray access is monomorphic. |
| Iterate column (B3-equiv) | 2.69x | **2.5–3.0x** | Same column access. Slightly better because vec.len <= vec.capacity (no wasted slots to skip). |
| Push/pop churn (B2-equiv) | 0.69x | **0.80–1.0x** | Push = increment len + write fields. Pop = decrement len. No bitmap, no free-list. |
| Sustained load (B8-equiv) | parity | **Parity or better** | Simpler per-tick bookkeeping. |

**Trade-off:** vec only supports ordered append/remove. Cannot remove entity #5000 from the middle — use slab for that. Different tools for different workloads.

**`for..of` iteration on vec:** trivially simple because there are no holes. The iterator just loops 0..len and rebases the shared handle. ~10 lines of code. Recommended to ship with vec from day one (unlike slab, where `for..of` requires occupancy-checking logic and was deferred).

**Implementation reuse:** vec uses the same SoA layout engine, column codegen, handle codegen, and TypedArray infrastructure from milestone-3. The only new code is the container logic itself (push/pop/grow). The growth strategy (allocate new ArrayBuffer at 2x capacity, copy columns via TypedArray.set()) is straightforward.

**Estimated effort:** 3–4 tasks. Layout + container + tests + benchmarks.

---

### Option B — Optimize slab internals (no new features)

**What changes:**

| Change | Expected impact | Effort |
|---|---|---|
| Replace JS `Array` free-list with pre-allocated `Uint32Array` + stack pointer | B1/B7: 0.26x → ~0.40x. B2: 0.69x → ~0.80x. Eliminates Array.push/pop GC pressure. | Low |
| Inline bitmap ops in insert/remove (avoid function-call boundary) | ~5% on B2 | Low |
| Add `slab.forEach(fn)` that iterates internally (skip has+get from user code) | B3 handle: 0.88x → ~0.95x | Low |
| Flatten sub-handle rebase (avoid recursive function calls for nested structs) | ~5% on B3 for deeply nested structs | Medium |

**Honest assessment:** moves numbers 20–30%. Won't flip any losing scenario to a win. B1/B7 stays behind because the fundamental insert overhead (bitmap + free-list + rebase) can't be eliminated from slab's architecture — it needs those structures to support random insert/remove.

**When to do it:** fold into the `vec()` milestone as a side task. The slab optimizations are worth doing for users who need random removal, but they're not the priority path to "beat JS."

---

### Option C — `.iter()` lazy chain (ergonomics, minor perf)

**What it is:** spec §4.5. Lazy iterator with filter/map/take/reduce/collect. Single-pass, zero intermediate arrays.

```ts
particles.iter()
  .filter(p => p.life > 0)
  .map(p => p.pos.x)
  .reduce(0, (sum, x) => sum + x)
```

**Performance impact on existing scenarios:** small. The underlying iteration speed is the same (TypedArray[slot]). The win is avoiding intermediate array allocations for chained operations — relevant for B4-style filter chains, not for B3-style simple iteration.

**When to do it:** after vec lands. `.iter()` is an ergonomics layer that works on top of any container (slab or vec). It doesn't need its own milestone — it can be one task inside a future milestone.

---

### Option D — `bump()` arena allocator (niche, very fast creation)

**What it is:** spec §4.4. The fastest possible allocator. `alloc()` = increment a pointer. No per-item free. Drop everything at once.

**Performance impact:** would dominate B5-style "allocate N temporaries, use them, discard all" scenarios. `bump.alloc()` is ~1ns (pointer increment) vs slab.insert() ~5–10ns or JS object creation ~10ns.

**When to do it:** after vec. bump is a specialized tool for transient allocation patterns (frame-scoped scratch buffers, temporary computation results). It doesn't help sustained-load scenarios.

---

## 4. Recommended Milestone-4 Scope

**Primary:** `vec()` container (Option A)
**Secondary:** slab free-list optimization to Uint32Array (Option B, partial — fold in as one task)

**Defer to milestone-5+:** `.iter()` lazy chain, `bump()`, `slab.forEach()`, `for..of` on slab.

### Rationale

vec has the highest expected impact because it eliminates the structural overheads (bitmap, free-list, occupancy branching) that slab cannot shed. For ordered workloads — which are the majority of real-world hot-path patterns (particle systems, physics updates, render batches, log buffers) — vec should achieve handle-iteration parity or better vs plain JS, while retaining the full SoA + column + GC-pressure advantage.

Slab remains the right choice for workloads with random insert/remove (entity managers, connection pools, object recyclers). Optimizing its free-list to Uint32Array is cheap and worth doing in parallel.

### Expected milestone-4 deliverables

1. `vec(def, initialCapacity?)` with push/pop/get/len/capacity/clear/drop/column/buffer
2. `for..of` iteration on vec (trivial — no holes)
3. Growth strategy: double capacity on overflow, copy columns via TypedArray.set()
4. New benchmark scenarios: B1-vec, B2-vec, B3-vec-handle, B3-vec-column
5. Slab free-list optimization (Uint32Array stack, one task)
6. Full benchmark report comparing slab vs vec vs plain JS

### Performance gates (aspirational, not blocking)

| Scenario | Target |
|---|---|
| Vec create 100k (B1-vec) | >= 0.70x JS |
| Vec handle iteration (B3-vec) | >= 1.0x JS |
| Vec column iteration | >= 2.5x JS |
| Vec push/pop churn (B2-vec) | >= 0.80x JS |
| Slab B2 after free-list fix | >= 0.80x JS |
| All GC object counts | <= 1000 (preserve ~272x win) |
| All tail latency | preserve milestone-3 wins |

---

## 5. Longer-Term Feature Priority

| Priority | Feature | Rationale |
|---|---|---|
| 1 (milestone-4) | `vec()` | Highest perf impact for ordered workloads |
| 2 (milestone-4) | Slab Uint32Array free-list | Cheap, improves slab churn |
| 3 (milestone-5) | `.iter()` lazy chain | Ergonomics + zero-alloc filter/map chains |
| 4 (milestone-5) | `bump()` arena | Niche fast allocator for transient data |
| 5 (milestone-6) | `slab.forEach()` / `for..of` on slab | Ergonomics for slab iteration |
| 6 (milestone-7+) | String types (`str:N`, `string`) | Phase 2 of the design spec |
| 7 (future) | npm publish + semver | When API stabilizes |
