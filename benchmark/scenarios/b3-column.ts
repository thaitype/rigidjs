import { struct, slab } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B3-column — Iteration + mutate via direct TypedArray column access
// Key metric: opsPerSec vs B3 JS baseline (same workload, fastest RigidJS tier)
//
// This scenario is the "receipts" proof that the SoA rewrite was worthwhile.
// It uses the SAME Particle struct, same N (100k), same arithmetic as b3-iterate-mutate.ts.
// The difference: instead of going through a Handle (h.pos.x += h.vel.x), the hot loop
// accesses the pre-resolved TypedArray column views directly:
//
//   posX[i] += velX[i]
//
// This is the "absolute maximum speed" tier of RigidJS access. The column refs are
// resolved ONCE in setup() — NOT inside fn() — so the hot loop is a pure
// Float64Array[i] indexed load+store with zero method calls, zero slot checks,
// zero Map lookups, and zero handle dispatch.
//
// OCCUPANCY NOTE: This loop does NOT call slab.has(i) before accessing each slot.
// In B3-column, the slab is filled to full capacity in setup() and never modified
// during the benchmark, so every slot is occupied and the has() check is redundant.
// This is a valid representation of the hot-inner-loop tier: when you know your
// slab is densely populated (as is typical for particle systems), skipping has()
// gives maximum throughput. Users who need to handle gaps can add has() at the cost
// of a small throughput penalty. The B3 handle-based scenario (b3-iterate-mutate.ts)
// includes has() for structural correctness — the difference in numbers between B3
// and B3-column therefore includes BOTH the column-vs-handle cost AND the has()-check
// cost. Both are real costs that disappear in the column tier.
//
// JS baseline comparison: B3 JS baseline (100k pos.x += vel.x) from b3-iterate-mutate.ts
// is the denominator. B3-column's ratio vs that baseline is the "SoA was worth it" receipt.
// ---------------------------------------------------------------------------

// Use the SAME struct definition as b3-iterate-mutate.ts for apples-to-apples parity.
const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })
const Particle = struct({ pos: Vec3, vel: Vec3 })

// N must match b3-iterate-mutate.ts
const N = 100_000

// Module-scoped state — built once in setup(), dropped in teardown().
// Column refs resolved in setup() and stored here so fn() reads them
// directly as pure Float64Array indexed accesses (zero overhead).
let rigidSlabCol = slab(Particle, N)
let posX: Float64Array = rigidSlabCol.column('pos.x')
let velX: Float64Array = rigidSlabCol.column('vel.x')
let particleCount = N

export const b3ColumnRigidJs: Scenario = {
  name: 'B3-column RigidJS slab (100k column posX[i] += velX[i])',
  setup() {
    // Build a fresh slab and fill it to N.
    rigidSlabCol = slab(Particle, N)
    for (let i = 0; i < N; i++) {
      const h = rigidSlabCol.insert()
      h.pos.x = i
      h.pos.y = 0
      h.pos.z = 0
      h.vel.x = 1
      h.vel.y = 0
      h.vel.z = 0
    }
    // Resolve column TypedArray refs ONCE here. The hot loop reads directly from
    // these module-scoped refs — no Map lookup, no method call, no dispatch.
    posX = rigidSlabCol.column('pos.x')
    velX = rigidSlabCol.column('vel.x')
    particleCount = rigidSlabCol.capacity
  },
  fn() {
    // Pure TypedArray indexed-access loop. No has() check — slab is densely packed.
    // No handle. No getter dispatch. No slot check. This is the hot path.
    // The non-null assertions (!  ) are required by strict noUncheckedIndexedAccess
    // but have zero runtime cost — TypedArray indexed access is always defined within bounds.
    for (let i = 0; i < particleCount; i++) {
      posX[i] = posX[i]! + velX[i]!
    }
  },
  teardown() {
    rigidSlabCol.drop()
  },
  iterations: 100,
  warmup: 10,
}

// No allocate() phase — B3-column is a throughput measurement, not an
// allocation-pressure measurement. B1 / B7 still own the allocation signal.

export const b3ColumnScenarios: readonly Scenario[] = [b3ColumnRigidJs]
