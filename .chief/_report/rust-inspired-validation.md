# Rust-Inspired Validation for RigidJS

**Status:** Discussion / design exploration
**Audience:** chief-agent, future milestone planners
**Not a contract — do not treat any API sketch here as binding.**

---

## 1. Problem statement

RigidJS promises Rust-like memory discipline in JavaScript: contiguous buffers, zero hot-path allocation, handle reuse, deterministic drop. The natural next question is whether it can also inherit Rust's **validation discipline** — catching bad writes at the earliest possible moment, ideally at compile time.

The current milestone-2 surface exposes two write paths:

| Path | Today | Future |
|---|---|---|
| `const h = slab.insert(); h.pos.x = 100` | shipped | — |
| `slab.insert({ pos: { x: 100 }, ... })` | not yet | planned in spec §4.2 ("future") |

The first path is allocation-free and maximally fast but validation-poor — a write of `h.hp = 300` into a `u8` field wraps silently to `44`. The second path is slower but is the natural place to run strict validation because the caller already accepted an object literal.

This report explores:

1. What Rust gets for free at compile time and why
2. What TypeScript can and cannot match
3. A tiered validation model RigidJS should adopt
4. Specific design opportunities for RigidJS
5. The radical option: a dedicated RigidJS compiler / build-time transformer

---

## 2. What Rust gets for free (and why it matters)

Rust's numeric type system is the root of its validation power. `u8`, `i16`, `u32`, `f32`, `f64` are **distinct types**, not refinements of a single `number`. This single fact unlocks:

- **Literal range check.** `hp: 300` with field type `u8` is a compile error. The compiler evaluates the literal, compares to `u8::MAX`, and rejects.
- **Integer vs float.** `frame: 3.14` with field type `u32` is a compile error. No silent truncation.
- **Sign check.** `hp: -1` with field type `u8` is a compile error.
- **Struct literal completeness.** `Particle { pos, vel }` fails if `life` is missing. Extra fields are also rejected because there is no "open" struct literal syntax.
- **Newtype zero cost.** `struct Meters(f32)` compiles to a plain `f32` at runtime. Branding has no overhead.
- **`try_into` / `checked_*`.** Runtime conversions are explicit opt-ins; the caller decides wrap/saturate/panic semantics.

The important observation is that Rust does **not** validate everything at compile time either. What it does is push the boundary inward: "runtime value" is a smaller surface in Rust because more things can be proven about literals and type shape. Runtime value from a network request still needs `try_into()` exactly like JS.

**Lesson for RigidJS:** the win is not "zero runtime checks" — it is "runtime checks only at real boundaries."

---

## 3. Where TypeScript hits its ceiling

TypeScript can handle a surprising amount of this if the generics are written correctly:

```ts
type StructInput<F> = {
  [K in keyof F]: F[K] extends StructDef<infer G>
    ? StructInput<G>
    : F[K] extends NumericType
      ? number
      : never
}
```

With this, `insert({ pos: { x: 100 }, life: "hello" })` fails at compile time on `life: "hello"` and on missing `pos.y`. That covers roughly 70% of what Rust catches for free.

The missing 30% is **numeric refinement**. TS cannot express:

- "this number must be in `[0, 255]`"
- "this number must be an integer"
- "this number must not be NaN"
- "a `u8` field is distinct from a `u32` field"

Workarounds exist but all of them trade ergonomics or compile speed:

| Workaround | Cost | Verdict |
|---|---|---|
| Branded types: `type U8 = number & { __u8: void }` + factory `u8(100)` | Every literal must be wrapped. Factory = runtime check. | **Reject.** Ergonomic tax too high for a zero-ceremony library. |
| Enumerated literal unions: `0 \| 1 \| 2 \| ... \| 255` | 256-entry union works; 65,536 for u16 kills tsc. | **Reject.** Does not scale. |
| Template literal + conditional types to parse literals | Extremely fragile, does not handle runtime values, slows compilation. | **Reject.** |
| Const assertion with helper: `insert(pure({ hp: 300 } as const))` | Requires const literals everywhere; breaks for computed values. | **Reject.** |

**Conclusion:** pushing TS beyond "shape + basic type" is negative ROI for RigidJS. The 70% is free and worth taking; the last 30% belongs to runtime or to a dedicated toolchain (see §6).

---

## 4. Proposed tiered validation model

Adopt Rust's mindset of tiered validation and document it explicitly in the public API contract.

### Tier 0 — TypeScript type system (always on, zero cost)

Covers:

- Field presence and absence
- Field type (number vs object vs string)
- Nested struct shape
- Excess property rejection via TS strictness
- Handle accessor typing (already delivered in milestone-1/2)

No runtime work. This tier is free and should be maximized.

### Tier 1 — `insert()` zero-arg path (hot path, zero cost)

`insert()` with no argument returns a handle. The user writes fields directly via accessors. **No validation.** The caller has accepted the deal: the price of speed is that `h.hp = 300` silently wraps.

This tier exists for tight loops (game simulation, particle systems, SoA-style transforms). Document it as the "unchecked" path.

### Tier 2 — `insert({...})` object path (init path, runtime validated)

`insert({...})` accepts an object literal, validates atomically, and commits. Validation covers exactly what TS cannot:

- Integer types: `Number.isInteger(v)` and range `[min, max]` per numeric kind
- Unsigned types: `v >= 0`
- Float types: optionally reject `NaN` / `Infinity` (policy knob)
- Nested struct recursion
- Defensive `undefined` check for fields TS marked required but runtime input may still omit (JSON boundary)

Strict semantics — no auto-clamp, no auto-wrap. Out-of-range throws before any byte is written to the buffer. This preserves the **atomicity** guarantee: either the full object lands in the slot or nothing does.

Runtime cost is acceptable here because the caller already accepted an object allocation. `insert({...})` is explicitly positioned as the "init / editor / config" path, not the hot loop.

### Tier 3 — External boundary adapters (future, optional)

When input comes from JSON, network, or user forms, even TS shape check is meaningless (`any` slips through). A thin helper could pair a `StructDef` with a Zod-like validator generated from the same definition:

```ts
const ParticleSchema = structSchema(Particle)
const data = ParticleSchema.parse(untrustedJson)  // throws on shape or range
particles.insert(data)                             // Tier 2 re-validates (cheap)
```

This would be a separate module, opt-in, and zero cost if unused.

---

## 5. Concrete opportunities for RigidJS

Below is a prioritized list of concrete improvements the framework should consider. Each is independent — cherry-pick based on milestone goals.

### 5.1 Ship `insert({...})` with strict Tier-2 validation (high value)

The spec already lists this as "future." Making it the first milestone-3 task would close the largest ergonomic gap and establish the tiered model in code.

Design sketch (non-binding):

```ts
insert(obj?: StructInput<F>): Handle<F> {
  if (this._dropped) throw new Error("slab has been dropped")
  if (this._len >= this._capacity) throw new Error("slab is full")

  if (obj !== undefined) this._validate(obj, this._def, "")

  const slot = this._allocSlot()
  const h = this._handle._rebase(this._view, slot * this._stride, slot)
  if (obj !== undefined) this._applyFields(h, obj, this._def)
  return h
}
```

`_validate` walks the `StructDef` tree once per call, recursing into nested struct fields. `_applyFields` runs second and trusts the validator's output — no duplicate checks.

### 5.2 Numeric-kind validator tables (medium value)

Rather than writing `if (kind === "u8") ...` branches, precompute per-kind validator functions at `struct()` call time and store them in the `StructDef`:

```ts
const U8_VALIDATOR = (v: unknown, path: string) => {
  if (typeof v !== "number") throw new Error(`${path}: expected number`)
  if (!Number.isInteger(v)) throw new Error(`${path}: expected integer`)
  if (v < 0 || v > 255) throw new Error(`${path}: u8 out of range: ${v}`)
}
```

`_validate` then does a single function dispatch per leaf field. This keeps `insert({...})` performance predictable and matches the existing "build metadata at struct() time" pattern used by handle codegen.

### 5.3 Validator code generation (high value, consistent with current philosophy)

RigidJS already generates handle accessor classes with `new Function()` to avoid per-access closures. The same trick applies to validators:

```ts
// Generated at struct() time for Particle
function validateParticle(obj, path) {
  if (typeof obj !== "object" || obj === null) throw ...
  validateVec3(obj.pos, path + ".pos")
  validateVec3(obj.vel, path + ".vel")
  const life = obj.life
  if (typeof life !== "number") throw ...
  // ...
}
```

A flattened, monomorphic, JIT-friendly function beats a tree walk every time. This is the most "RigidJS-native" solution because it mirrors what the library already does for reads and writes.

### 5.4 Optional `NonNaN` / `NonNegative` policy flags (low value, document only)

Rather than baking NaN policy into core, expose it as a slab-level option:

```ts
slab(Particle, 50_000, { rejectNaN: true })
```

Default `false` (match JS semantics). This gives the library an answer to "what about NaN?" without forcing opinion. Not worth doing until at least one user asks.

### 5.5 Branded numeric helpers as opt-in module (low value)

Ship a tiny helper module for users who want Rust-like nominal typing at the call site:

```ts
import { u8, i16, f32 } from "rigidjs/num"
particles.insert({ hp: u8(100), frame: u32(42), life: f32(1.0) })
```

Each helper runtime-checks and type-brands. Verbose but unambiguous. Should be **purely opt-in** — the default API must stay ceremony-free. Most users will never touch this.

### 5.6 Dev-mode strict `insert()` (medium value)

Add a development build flag that makes even the zero-arg `insert()` path run Tier-2 checks on every field write. Ship-time the flag is off; test-time it is on. This catches bugs during development without paying the cost in production hot loops.

Implementation: generate two accessor classes per struct — one with checks, one without. Select at `struct()` time based on `process.env.RIGIDJS_STRICT` or an explicit `struct(fields, { strict: true })`.

This gives users the Rust-style "debug panics, release wraps" semantics — the same tradeoff Rust itself makes for arithmetic overflow.

### 5.7 Schema export (low value, future interop)

Since every `StructDef` already carries field kinds and offsets, exposing a schema serializer is almost free:

```ts
Particle.toJSONSchema()
// → { type: "object", properties: { pos: {...}, ... } }
```

Enables interop with Zod, ajv, JSON Schema tooling, and auto-generated forms. Minor surface, big leverage for users building editors on top of RigidJS.

---

## 6. The radical option — a RigidJS compiler

The question was: **could RigidJS have its own compiler to validate at compile time, the way Rust does?**

Short answer: **yes, in multiple forms, ranging from a lightweight lint plugin to a full source-transforming build step.** Whether any of them should be built depends on how far the project wants to chase the Rust analogy.

### 6.1 Why a dedicated tool is even on the table

The core limitation of Tier 0 is TypeScript itself. TS cannot model numeric ranges because it was not designed to. But RigidJS owns its own API surface and already stores rich metadata (field kinds, offsets, sizes) at `struct()` call time. A tool that reads the user's source code and cross-references it with that metadata can enforce everything Rust enforces for struct literals — without asking TypeScript to do anything new.

The key insight: **validation doesn't have to happen inside the type system.** It can happen in a tool that runs before compilation.

### 6.2 Option A — ESLint / Biome plugin (lightweight, realistic)

Write a custom lint rule that recognizes RigidJS patterns and validates literal values against struct definitions.

Scope:
- Detect calls like `slab.insert({ hp: 300 })`
- Resolve the slab's `StructDef` via TS type information (lint rules can hook into tsc)
- If `hp` is a `u8` field and `300` is a literal, report an error
- Works for nested literals, const-folded expressions, and `as const` objects

Tooling: ESLint with `@typescript-eslint/parser` gives access to the type checker. Biome's Rust-based analyzer can do the same and is faster.

**Realism:** high. This is a weekend project for someone who has written ESLint rules before. It covers 90% of the Rust compile-time wins for zero impact on the library itself. Users opt in by installing the plugin.

**Gap:** does not help for non-literal values (`insert({ hp: userInput })`). That is fine — Tier 2 runtime check handles those.

### 6.3 Option B — TypeScript transformer / ts-patch plugin (medium)

A `ts.TransformerFactory` that runs during `tsc` or `bun build`, inspects `insert({...})` call sites, and either:

- Emits compile errors for out-of-range literals, or
- Rewrites the call into a pre-validated form (inlining the checks)

This gets you both static errors **and** potentially zero-cost runtime validation — the transformer can remove the runtime check when it has already proven the literal is valid at build time.

**Realism:** medium. Requires shipping a tsc plugin, which has a fractured ecosystem (`ts-patch`, `ts-node`, various bundler integrations). Debugging is harder than ESLint. Payoff is higher because it enables compile-time guarantees that a lint rule cannot — e.g. removing runtime checks when proven safe.

**Gap:** still cannot enforce struct literal completeness beyond what TS already does. Still cannot track newtype branding.

### 6.4 Option C — custom DSL compiled to TS (heavyweight)

The full Rust analogy: a `.rgd` file format where users define structs:

```rgd
struct Particle {
  pos: Vec3,
  vel: Vec3,
  life: f32,
  hp: u8,
}
```

A compiler reads `.rgd` files and emits `.ts` with full `StructDef`, handle classes, validator functions, and branded numeric wrappers. Users get:

- Rust-identical syntax for struct definition
- Compile-time range check on all literals in `.rgd` files
- Auto-generated validators that match the struct exactly
- A source of truth that is not TypeScript-limited

**Realism:** low-to-medium. The compiler is real work — parser, type checker, codegen — and bundler integration multiplies effort. Developer ergonomics suffer because `.rgd` files live outside normal TS tooling (no autocomplete in struct bodies until editor plugin exists).

**Why consider it anyway:** it is the only path that delivers true Rust-level guarantees inside a JS project. If RigidJS's long-term vision is "Rust memory model for JS developers who want Rust discipline," the DSL is the honest endpoint.

**Why not to do it now:** the library is pre-1.0. Shipping a compiler before the runtime API stabilizes creates two moving targets. Wait until `slab`, `vec`, `bump`, `strings` are all locked and users are asking for stronger guarantees.

### 6.5 Option D — WASM-backed validator with shared schema (out of scope, interesting)

Write the validator in Rust, compile to WASM, share the schema between the RigidJS TS API and the Rust validator. Users get Rust-quality error messages and Rust-speed validation. Schema is defined once.

**Realism:** low for RigidJS itself — WASM runtime dependency contradicts the "zero runtime dependency" rule in CLAUDE.md. Could exist as an opt-in companion package.

### 6.6 Recommendation

Pursue in this order, only as needed:

1. **Land Tier 0 + Tier 2 first** (§5.1, §5.2, §5.3). This delivers most of the value without any new tooling.
2. **Evaluate after one real-world user.** If users report bugs from literal out-of-range writes that Tier 2 would have caught at runtime but they want static detection, that is the signal to start §6.2 (ESLint plugin).
3. **ESLint plugin** if signal exists. Low cost, high return. Opt-in.
4. **TS transformer** only if the ESLint plugin proves popular and users start asking for runtime-cost elimination (proof-carrying literals).
5. **DSL compiler** only after 1.0 and only if the library's identity clearly converges on "Rust-in-JS" rather than "fast memory primitives in JS."

The WASM option is interesting but belongs to a separate project if it ever happens.

---

## 7. Non-goals and anti-patterns to avoid

- **Do not auto-clamp or auto-wrap.** Silent correction is worse than silent wrap because it hides bugs longer. Throw loudly or do nothing.
- **Do not bake NaN policy into core.** Users have legitimate reasons to store NaN (sentinel values, physics sims). Make it a knob, default off.
- **Do not force branded numeric types at the call site.** The default write syntax must stay ceremony-free. Branding is opt-in.
- **Do not duplicate validation logic in two places.** Generate it from `StructDef` so it always matches reality.
- **Do not validate in the Tier 1 hot path.** That path exists precisely because some users need zero overhead. Keep it pristine.
- **Do not ship a compiler before the runtime API is stable.** Moving two surfaces at once multiplies breakage risk.

---

## 8. Summary

The TypeScript type system covers roughly 70% of Rust's compile-time validation wins for free. The remaining 30% belongs to runtime — specifically to the `insert({...})` object path, which is the natural place to pay validation cost because the user already opted into object allocation.

RigidJS should adopt a tiered validation model (§4), ship strict `insert({...})` with generated validators (§5.1, §5.3), and hold off on anything more ambitious until real users generate real signal.

A dedicated compiler is technically feasible in four flavors (ESLint plugin, TS transformer, custom DSL, WASM validator). The ESLint plugin is the pragmatic near-term option; the DSL compiler is the honest long-term endpoint **if** the project identity converges on "Rust memory discipline for JS." Both decisions can wait until after 1.0.

The biggest risk is over-engineering validation before anyone has used the library enough to care. Ship Tier 0 + Tier 2, wait for signal, then choose.
