# Profiling Report: Hybrid Vec Creation at N=10

**Date:** 2026-04-12
**Profiling scripts:** `tmp/profile-hybrid-creation.ts`, `tmp/profile-vec-constructor-deep.ts`, `tmp/profile-remaining-gap.ts`, `tmp/profile-closure-count.ts`, `tmp/profile-confirm.ts`
**Machine:** macOS arm64, Bun v1.3.8 (JavaScriptCore)

## Summary

At N=10, `vec(Vec3)` + 10x push + drop costs **~263 ns/op** vs the JS baseline of **~58 ns/op** — approximately **4.5x** slower (not 0.46x; that was opsPerSec ratio inverted). The root cause is the `vec()` constructor itself at **~230 ns** per call, driven by expensive `get X()` property getters and `[Symbol.iterator]` computed key in the return object literal, which trigger internal `defineProperty()` calls on every invocation.

## Measured Numbers (Bun 1.3.8 / JSC / arm64)

| Operation | ns/op |
|---|---|
| JS baseline `new Array(N) + 10x { x, y, z }` | 58 ns |
| Full `vec(Vec3) + 10x push + drop` at N=10 | 263 ns |
| **Ratio** | **4.5x slower** |
| `vec(Vec3).drop()` (constructor only) | 230 ns |
| `10x push` on pre-existing vec | 70 ns |
| `10x push + 3x field writes` on pre-existing vec | 81 ns |
| `push()` field writes delta | 11 ns |

## Section 1: vec() Constructor Cost Breakdown

| Sub-operation | ns/op |
|---|---|
| Option parse branches | 3 ns |
| `def._columnLayout` cache hit | 2 ns |
| Closure variable declarations | 4 ns |
| Factory cache check (`if !def._JSFactory`) | 3 ns |
| SoA state declarations (Map x2, arrays, `_swapFn = () => {}`) | 2 ns |
| Inner function declarations (`buildColumns`, `grow`, etc.) | 3 ns |
| **Return object literal (5 getters + Symbol.iterator)** | **~200 ns** |

**Finding: The return object literal dominates at ~200 ns, driven entirely by 5 `get X()` getters (~88 ns) and 1 `[Symbol.iterator]` computed key (~42 ns).**

## Section 2: push() Cost in JS Mode (on pre-existing vec)

| Sub-operation | ns/op |
|---|---|
| `_createJSObject()` factory call | 4 ns |
| `_items.push(obj)` | 17 ns |
| `factory() + push()` combined | 10 ns |
| `3x field write` (h.x, h.y, h.z) | 3 ns |
| Full `10x push + field writes` | 81 ns |
| Per-push total | ~8 ns |

Push itself is fast. The dominant cost is construction, not the push loop.

## Section 3: Cost Decomposition at N=10

```
vec() constructor:    207 ns    (~71% of total 292 ns)
10x push only:         68 ns    (~23% of total)
field writes (3x):     12 ns    (~4% of total)
```

**The constructor accounts for ~71% of the total N=10 cost.**

## Section 4: Root Cause — Getter Syntax and Computed Keys

The breakthrough finding: it is NOT closure count, scope size, or inner function declarations. It is the **property descriptor syntax** in the return object literal.

| Expression | ns/op | Notes |
|---|---|---|
| 15 regular `method()` closures | 5 ns | Simple property assignment |
| 5 `get X()` getters | **88 ns** | Each calls `Object.defineProperty()` internally |
| 1 `[Symbol.iterator]` computed key | **42 ns** | Computed key also calls `defineProperty()` |
| 11 methods + 5 getters + Symbol.iterator | **197 ns** | Matches vec() return shape |
| Class instance (prototype methods) | **5 ns** | Pre-defined on prototype, no per-call defineProperty |

**Per-getter cost: ~18 ns each. Symbol.iterator computed key: ~42 ns.**

vec() returns an object with **exactly**:
- 11 regular methods: `push`, `pop`, `get`, `swapRemove`, `remove`, `clear`, `drop`, `reserve`, `forEach`, `graduate`, `column`
- 5 getters: `len`, `capacity`, `buffer`, `mode`, `isGraduated`
- 1 computed key: `[Symbol.iterator]`

The 5 getters and `[Symbol.iterator]` together cost **~130 ns** per vec() call. Combined with the remaining method/closure overhead, that explains the ~200 ns return object cost.

### Why Getters are Expensive

In JavaScript, `get X()` syntax in an object literal is **not** a simple property assignment. It compiles to an internal `Object.defineProperty(obj, 'X', { get: function() {...} })` call, which creates a property descriptor object, checks for conflicts, and installs the descriptor. This is a much heavier operation than `obj.method = function() {...}`.

Similarly, `[Symbol.iterator]` is a computed property key, which also requires `defineProperty()` to look up the symbol and install the property.

Regular method shorthand (`m() {}`) in an object literal IS a simple assignment (`obj.m = function() {}`) and costs essentially nothing beyond the function allocation.

## Section 5: Absolute Minimum Comparison

| Approach | ns/op | Ratio vs JS |
|---|---|---|
| Raw factory + array loop (no wrapper) | 48 ns | 0.82x |
| `makeFastVec()` (3-closure wrapper) | 61 ns | 1.05x |
| Minimal class-based vec (prototype) | 65 ns | 1.12x |
| Full `vec(Vec3)` | 263 ns | 4.5x |

A purely closure-based minimal wrapper with no getters is already within 1.05x of JS. The gap is entirely from the defineProperty overhead in the vec() return object.

## Section 6: Hypotheses Evaluated

| Hypothesis | Verdict | Evidence |
|---|---|---|
| `computeColumnLayout` called every vec() | NOT the cause | Cached on `def._columnLayout`, costs 2 ns |
| `new Map()` creation for SoA state | NOT the cause | Costs 3 ns total |
| `_items = []` creation | NOT the cause | Costs 3 ns |
| Factory cache check | NOT the cause | Costs 3 ns |
| Closure scope size | NOT the cause | Large scope costs same as small scope |
| Inner function declarations | NOT the cause | Costs 3 ns total |
| Getter `get X()` syntax | **ROOT CAUSE** | 88 ns for 5 getters (18 ns each) |
| `[Symbol.iterator]` computed key | **MAJOR CAUSE** | 42 ns |

## What Dominates at N=10

At N=10, the execution profile is:

1. **`vec()` constructor** — 230 ns (71% of total)
   - Getter + Symbol.iterator defineProperty calls account for ~130/230 ns
   - Remaining ~70 ns: function/closure allocation for 11 regular methods + outer scope setup
2. **10x push loop** — 70 ns (23%)
   - ~7 ns/push: factory call + array push + assertLive check
3. **Field writes (h.x/h.y/h.z × 10)** — 12 ns (4%)

The benchmark creates `vec(def)` fresh each iteration, so construction cost is incurred every iteration. This is the realistic use case for N=10.

## Recommendations

### Recommendation 1 (HIGH IMPACT): Convert return object to a class

Replace the current `return { ... }` pattern with a class that defines methods on its prototype. This eliminates all per-call `defineProperty()` costs for getters and computed keys.

```typescript
class VecImpl<F extends StructFields> implements Vec<F> {
  // closed-over state stored as instance properties
  _len = 0
  _dropped = false
  _items: object[] = []
  _createJSObject: (() => object) | null
  // ...

  push(): Handle<F> { ... }
  drop(): void { ... }
  get len() { return this._len }
  get mode() { return this._mode }
  // etc.
}
```

A class instance costs ~5 ns to construct vs ~230 ns for the current return object.

**Estimated savings: ~200 ns per vec() call. Would bring N=10 from 4.5x to approximately 1.3-1.5x JS.**

The remaining gap (~60-70 ns for push loop) is close to the JS baseline already.

### Recommendation 2 (MEDIUM IMPACT): Lazily define Symbol.iterator

If keeping the object literal pattern, `[Symbol.iterator]` can be set lazily on first use (since it's not used in hot creation paths). This saves ~42 ns.

```typescript
const v = { push, pop, ... }
Object.defineProperty(v, Symbol.iterator, { get() { ... } })
// or: assign lazily
```

This alone saves ~42 ns but doesn't address the getter issue.

### Recommendation 3 (LOW IMPACT): Replace getters with explicit methods

Replace `get len()` with `getLen()`, `get mode()` with `getMode()`, etc. This trades ergonomics for performance. Each getter removed saves ~18 ns.

Not recommended given the API contract is getter-based.

### Recommendation 4 (ARCHITECTURAL): Shared prototype descriptor pre-built once

Pre-build the return object's property descriptors once at module load time and use `Object.create(proto)` instead of fresh object literals each time:

```typescript
const JsModeVecProto = {}
Object.defineProperty(JsModeVecProto, 'len', { get() { return this._len } })
// ...
function makeJsModeVec(createFn, graduateAt) {
  const v = Object.create(JsModeVecProto)
  v._len = 0; v._createJSObject = createFn; // etc.
  return v
}
```

This pays the defineProperty cost once at module load, not per vec() call.

## Conclusion

The 4.5x slowdown at N=10 is caused almost entirely by the `vec()` constructor creating a fresh object literal with `get X()` getters and a `[Symbol.iterator]` computed key on every call. These trigger `Object.defineProperty()` internally (~18 ns/getter, ~42 ns for Symbol.iterator), adding ~130 ns to every vec() construction.

The push loop itself is already efficient (~7-8 ns/push). With a class-based approach, N=10 should achieve 1.3-1.5x JS rather than 4.5x.

The primary recommendation is to convert `vec()` to return a class instance with prototype-defined methods. The class constructor would store closed-over state as instance fields and the prototype methods would access them via `this`.
