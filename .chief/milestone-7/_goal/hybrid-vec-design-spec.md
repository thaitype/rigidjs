# RigidJS Hybrid Vec Design Specification

**Version:** 0.1.0-draft
**Target Milestone:** M7
**Depends on:** M5 (SoA vec), M6 (codegen optimizations)

---

## 1. Problem Statement

RigidJS vec (SoA + TypedArray) dominates at large scale:

| Operation | RigidJS vs JS at N=100k |
|-----------|------------------------|
| column access | **2.42x faster** |
| indexed get(i) | **1.72x faster** |
| forEach | **1.88x faster** |
| sustained churn | **2.18x more ticks** |
| p99 latency at 1M | **37% lower** |

But loses badly at small scale:

| Operation | N=10 | N=100 | N=1,000 |
|-----------|------|-------|---------|
| Creation (slab) | 0.12x | 0.21x | 0.37x |
| Creation (vec) | 0.37x | 0.27x | 0.44x |
| Churn (slab) | 0.39x | 0.30x | 0.63x |

**Root cause:** Fixed per-container overhead (ArrayBuffer allocation + OS zero-fill + `new Function()` codegen + bitmap/freelist setup) is not amortized at small N. At N=10, the constructor cost alone accounts for the entire gap.

**Bright spot:** Column access already beats JS at N=100 (1.10x) and dominates at N=1,000 (3.18x). The SoA layout strategy works — the problem is purely initialization cost.

---

## 2. Design Overview

### Core Idea

A vec that starts in **JS mode** (plain JS objects, zero initialization overhead) and automatically **graduates** to **SoA mode** (TypedArray columns) when the collection grows past a threshold.

```
len < threshold  →  JS mode    (creation speed = JS speed)
len >= threshold →  SoA mode   (iteration speed = 2-3x JS, zero GC pressure)
```

This is architecturally identical to vec's existing grow mechanism:

| Event | What happens | Cost |
|-------|-------------|------|
| Vec grow (existing) | Allocate larger buffer + copy data | One-time spike, amortized |
| Hybrid graduate (new) | Allocate TypedArray columns + copy from JS objects | One-time spike, amortized |

Both are O(N) copy operations that happen once and are amortized over subsequent operations. Users already accept grow cost — graduate is the same pattern.

### Post-Graduate Behavior

Once graduated, the vec **never degrades back to JS mode** — even if items are removed and len drops below threshold. This follows Rust's `Vec` design:

> *"Vec will never automatically shrink itself, even if completely empty. This ensures no unnecessary allocations or deallocations occur. Emptying a Vec and then filling it back up to the same len should incur no calls to the allocator."*
> — Rust std::vec::Vec documentation

Rationale: Preventing grow-shrink-grow oscillation that would cause repeated allocation/deallocation.

If the user explicitly wants to reclaim memory, they can call `.shrinkToFit()`.

---

## 3. API

### Construction

```typescript
import { struct, vec } from 'rigidjs'

const Particle = struct({
  pos: Vec3,
  vel: Vec3,
  life: 'f32',
  id: 'u32',
})

// Default: hybrid mode, graduates at threshold (default 128)
const particles = vec(Particle)

// Custom threshold
const particles = vec(Particle, { graduateAt: 256 })

// Force SoA from the start (skip JS mode entirely)
const particles = vec(Particle, { mode: 'soa' })

// Force JS mode permanently (never graduate)
const particles = vec(Particle, { mode: 'js' })

// Pre-allocate capacity (SoA mode, like current vec behavior)
const particles = vec(Particle, { capacity: 100_000 })
// capacity implies mode: 'soa' — no point starting in JS mode
// if you already know you need 100k slots
```

### Usage — Identical Regardless of Mode

```typescript
// All of these work the same in JS mode and SoA mode
const p = particles.push()
p.pos.x = 100
p.vel.y = -9.8
p.life = 1.0

console.log(particles.len)      // current item count
console.log(particles.capacity)  // current buffer capacity
console.log(particles.mode)      // 'js' | 'soa'

// Iteration
for (const p of particles) {
  p.pos.x += p.vel.x
}

particles.forEach(p => {
  p.life -= 0.016
})

// Removal
particles.pop()
particles.swapRemove(index)

// Cleanup
particles.clear()         // reset length, keep buffer/mode
particles.shrinkToFit()   // reallocate to fit current length
particles.drop()          // release all memory
```

### Column Access

```typescript
// In SoA mode: returns TypedArray directly (zero-cost)
const posX = particles.column('pos.x')  // Float64Array

// In JS mode: triggers graduation first, then returns TypedArray
const posX = particles.column('pos.x')
// Internally:
//   1. Allocate TypedArray columns
//   2. Copy all JS object data → TypedArrays
//   3. Switch to SoA mode
//   4. Return column
// This is a one-time cost — subsequent column() calls are free

// Users who call column() clearly want SoA performance
// so auto-graduating is the correct behavior
```

### Explicit Mode Control

```typescript
// Check current mode
particles.mode           // 'js' | 'soa'

// Force graduation (even if below threshold)
particles.graduate()     // no-op if already in SoA mode

// Query whether graduated
particles.isGraduated    // boolean
```

---

## 4. Internal Architecture

### JS Mode Storage

```
particles (JS mode):
  _items: Array<JSObject>
  _items[0] = { pos: { x: 100, y: 0, z: 0 }, vel: { x: 5, y: -9.8, z: 0 }, life: 1.0, id: 0 }
  _items[1] = { pos: { x: 200, y: 0, z: 0 }, vel: { x: 3, y: -5.0, z: 0 }, life: 0.8, id: 1 }
  ...

  push()    → _items.push(createJSObject())    // JS engine optimized path
  get(i)    → return JSHandle wrapping _items[i] // plain property access
  forEach() → _items loop + JSHandle reuse
  pop()     → _items.pop()
```

JS objects are created with stable hidden class (all fields initialized in same order every time) to maximize JIT optimization.

### SoA Mode Storage

```
particles (SoA mode):
  _columns: {
    'pos.x': Float64Array [100, 200, ...]
    'pos.y': Float64Array [0, 0, ...]
    'pos.z': Float64Array [0, 0, ...]
    'vel.x': Float64Array [5, 3, ...]
    'vel.y': Float64Array [-9.8, -5.0, ...]
    'vel.z': Float64Array [0, 0, ...]
    'life':  Float32Array [1.0, 0.8, ...]
    'id':    Uint32Array  [0, 1, ...]
  }

  push()    → write to each TypedArray column
  get(i)    → return SoAHandle with index
  forEach() → SoAHandle reuse + rebase
  column()  → return TypedArray directly
  pop()     → decrement length
```

This is identical to the current vec implementation from M5/M6.

### Graduation Process

When `len` reaches `graduateAt` threshold during a `push()`:

```
Step 1: Allocate TypedArray columns
  For each field in struct:
    new Float64Array(capacity)  // or Uint32Array, etc.

Step 2: Copy data from JS objects → TypedArrays
  for (let i = 0; i < len; i++) {
    columns['pos.x'][i] = _items[i].pos.x
    columns['pos.y'][i] = _items[i].pos.y
    // ... all fields
  }

Step 3: Generate handle class via codegen
  new Function() → SoAHandle with hardcoded column references

Step 4: Release JS objects
  _items = null  // let GC collect the JS objects

Step 5: Switch mode
  _mode = 'soa'
  // All subsequent operations use SoA path
```

**Cost:** O(N) copy + one `new Function()` call. Same order as a vec grow event.

### Handle Behavior Across Graduation

**JS mode handle:**

```typescript
class JSHandle {
  private _obj: any
  get pos_x() { return this._obj.pos.x }
  set pos_x(v) { this._obj.pos.x = v }
}
```

**SoA mode handle:**

```typescript
class SoAHandle {
  private _idx: number
  get pos_x() { return this._posX[this._idx] }    // codegen: hardcoded column ref
  set pos_x(v) { this._posX[this._idx] = v }
}
```

**Do not hold handles across graduation.** When graduation occurs, JS mode handles become stale — they still point to the old JS objects which are no longer the source of truth. This is the same constraint as vec grow (handles may become stale after reallocation) and forEach (handle is reused each iteration). Document clearly.

---

## 5. Graduation Threshold

### Default: 128

Rationale from benchmark data:

| Crossover point | Operation | N where RigidJS >= 1x |
|-----------------|-----------|----------------------|
| ~100 | Column access | 1.10x at N=100 |
| ~1,000 | Slab churn | 1.15x at N=10,000 |
| ~10,000 | Vec churn | 0.91x at N=10,000 |
| Never (at current perf) | Creation | 0.60x at N=100,000 |

Column access — the primary SoA benefit — crosses 1x at N=100. Setting threshold at 128 means:

- Below 128: JS mode, creation/churn speed matches plain JS
- At 128: graduate, SoA column access already 1.10x+ faster
- Above 128: all SoA benefits active (2-3x iteration, zero GC pressure)

128 is also a power of 2, which is a natural initial TypedArray capacity.

### When Threshold Doesn't Apply

| Scenario | Behavior |
|----------|----------|
| `vec(T, { capacity: N })` | SoA mode immediately (capacity implies intent) |
| `vec(T, { mode: 'soa' })` | SoA mode immediately |
| `vec(T, { mode: 'js' })` | JS mode permanently, never graduate |
| `.column()` called | Graduate immediately regardless of len |
| `.graduate()` called | Graduate immediately regardless of len |

---

## 6. Expected Performance

### Small Scale (N=10 to N=100)

| Operation | Current vec (SoA only) | Hybrid vec (JS mode) | Expected |
|-----------|----------------------|---------------------|----------|
| Creation N=10 | 0.37x | ~1.0x | Match JS |
| Creation N=100 | 0.27x | ~1.0x | Match JS |
| Churn N=10 | 0.51x | ~1.0x | Match JS |
| Churn N=100 | 0.67x | ~1.0x | Match JS |
| Iteration N=10 | 0.55x (column) | ~1.0x (JS for..of) | Match JS |
| Iteration N=100 | 1.10x (column) | ~1.0x (JS property) | Match JS |

In JS mode, performance should be indistinguishable from plain JS because it IS plain JS objects internally.

### After Graduation (N >= 128)

| Operation | Expected | Source |
|-----------|----------|--------|
| Column access | 2.42x | M5 benchmark |
| Indexed get(i) | 1.72x | M5 benchmark |
| forEach | 1.88x | M6 benchmark |
| Sustained churn | 2.18x | M5 benchmark |
| GC objects | ~40 vs ~100k | M5 benchmark |
| RSS at 1M | 99MB vs 478MB | M5 benchmark |

### Graduation Spike

| N at graduation | Estimated copy time |
|-----------------|-------------------|
| 128 | ~10-20µs |
| 256 | ~20-40µs |
| 1,000 | ~80-150µs |

For reference, a single vec grow at 100k items costs ~180µs. Graduation at 128 items is negligible.

---

## 7. Edge Cases

### Handle Stale After Graduation

```typescript
const p = vec.get(0)         // JS mode handle
for (let i = 0; i < 200; i++) {
  vec.push()                  // at i=128, graduation triggers
}
p.pos.x = 10                 // ⚠️ writes to stale JS object, not TypedArray
```

**Mitigation:** Same as current vec grow behavior — document that handles should not be held across mutations that may trigger reallocation or graduation. The `.get()` method returns a fresh handle each call.

### Frequent Oscillation Around Threshold

```typescript
// Push to 128 → graduate
// pop back to 50
// push to 128 again → already graduated, no re-graduation
```

This is safe because graduation is one-way. No oscillation occurs.

### Mixed Access Patterns

```typescript
const v = vec(Particle)

// Phase 1: small, creation-heavy (JS mode, fast creation)
for (let i = 0; i < 50; i++) {
  v.push().pos.x = i
}
// mode = 'js', len = 50

// Phase 2: grow past threshold (graduates automatically)
for (let i = 50; i < 200; i++) {
  v.push().pos.x = i
}
// mode = 'soa', len = 200, graduated at len=128

// Phase 3: iterate with column access (SoA mode, fast iteration)
const posX = v.column('pos.x')
for (let i = 0; i < v.len; i++) {
  posX[i] *= 2
}
```

The hybrid vec adapts to the workload phase without user intervention.

---

## 8. Implementation Plan

### Step 1: JS Mode Layer

- Implement `JSHandle` class with plain property access
- Implement `_items: Array` storage with push/pop/get/forEach
- Generate JS object factory from struct schema (stable hidden class)

### Step 2: Graduation Logic

- Detect `len >= graduateAt` during push()
- Copy `_items` data → TypedArray columns
- Generate SoA handle class via existing codegen
- Switch `_mode` flag, null out `_items`

### Step 3: Mode-Aware Dispatch

- Each public method (`push`, `get`, `forEach`, `pop`, `column`, etc.) checks `_mode` and dispatches to JS or SoA implementation
- **Performance note:** The mode check is a single boolean branch. After JIT warmup with stable mode, the branch predictor will make this effectively free.

### Step 4: Codegen for JS Object Factory

- Generate a factory function that creates JS objects with all fields initialized in declaration order
- This ensures monomorphic hidden class across all instances

```typescript
// Generated from struct({ pos: Vec3, vel: Vec3, life: 'f32', id: 'u32' })
function createParticle() {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    life: 0,
    id: 0,
  }
}
// All particles share the same hidden class → JIT optimized
```

### Step 5: Benchmark Validation

Re-run full benchmark suite:

| Benchmark | Target |
|-----------|--------|
| B1-small (N=10, 100, 1000) creation | ~1.0x (match JS) |
| B2-small (N=10, 100, 1000) churn | ~1.0x (match JS) |
| B3-small (N=10, 100) iteration | ~1.0x (match JS) |
| B1 (N=100k) creation | >= 0.60x (no regression from graduation overhead) |
| B3 (N=100k) column/forEach/get | >= current (2.42x / 1.88x / 1.72x) |
| B8 sustained churn | >= current (2.18x) |
| B9 scaling curve | >= current at all scales |

---

## 9. Comparison with Alternatives Considered

### Alternative A: Always-JS Container ("gc-vec")

A container that wraps plain JS arrays permanently, adding only the structured API.

| | Hybrid Vec | Always-JS |
|---|---|---|
| Small N creation | ~1.0x ✅ | ~1.0x ✅ |
| Large N iteration | 2.42x ✅ | ~1.0x ❌ |
| GC pressure at scale | Near-zero ✅ | Same as JS ❌ |
| Complexity | Medium | Low |

Rejected: Gives up the core RigidJS value proposition (zero GC pressure at scale).

### Alternative B: Lower Fixed Overhead

Reduce ArrayBuffer allocation and codegen cost so SoA mode is viable at small N.

| | Hybrid Vec | Lower Overhead |
|---|---|---|
| Small N creation | ~1.0x ✅ | ~0.5-0.7x ❌ |
| Implementation | Medium | Very Hard |
| Fundamental limit | None (IS plain JS) | OS zero-fill is unavoidable |

Rejected: ArrayBuffer allocation + OS zero-fill is a fundamental OS-level cost. Cannot match JS object literal creation speed which the JIT compiles to a single opcode.

### Alternative C: User-Triggered Graduation

Require user to call `.graduate()` explicitly instead of auto-graduating.

| | Hybrid Vec (auto) | User-Triggered |
|---|---|---|
| DX | Automatic ✅ | Requires user decision ❌ |
| Correctness | Always optimal ✅ | User may forget ❌ |
| Predictability | Graduation may surprise | User controls timing ✅ |

Rejected as default: Auto-graduation provides better DX. But `.graduate()` is still available for users who want explicit control.

---

## 10. Success Criteria

The hybrid vec succeeds if:

1. **Small-scale creation at N=10-100 reaches ~1.0x JS** (currently 0.12-0.37x)
2. **Large-scale performance has no regression** vs current SoA vec
3. **Graduation spike is imperceptible** (< 50µs at default threshold of 128)
4. **API is unchanged** — existing vec code works without modification
5. **Mode transitions are invisible** — users don't need to know about JS/SoA modes unless they want to

---

## 11. References

- Rust `Vec` shrink policy: https://doc.rust-lang.org/std/vec/struct.Vec.html
- RigidJS M5 final report: benchmark data for all crossover points
- RigidJS M6 findings: codegen optimization results
- RigidJS Improvement Report: SoA + TypedArray analysis
