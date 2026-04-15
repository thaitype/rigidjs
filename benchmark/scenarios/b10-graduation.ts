import { struct, vec } from '../../src/index.js'
import type { Scenario } from '../harness.js'

// ---------------------------------------------------------------------------
// B10-graduation — Graduation spike timing
//
// Measures the one-time cost of transitioning a vec from JS mode to SoA mode
// at the default threshold (128 items). Target: < 50µs.
//
// Two scenarios:
//   B10-graduation-128: push 0→128, triggers graduation at push 128
//   B10-graduation-256: push 0→256 with graduateAt:256, triggers at push 256
//
// The "graduation spike" is the TOTAL time for the push that triggers
// graduation (Step 1: alloc TypedArrays + Step 2: copy data + Step 3: codegen).
//
// This scenario intentionally isolates the graduation event by measuring
// a single push-to-graduation operation, not the full construction loop.
// ---------------------------------------------------------------------------

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

function makeGraduationScenario(graduateAt: number): Scenario {
  // Pre-fill an array to (graduateAt-1) items in setup, then measure
  // just the final push that triggers graduation.
  let v = vec(Vec3, { graduateAt })

  return {
    name: `B10-graduation RigidJS graduateAt=${graduateAt}`,
    setup() {
      // Re-create vec in JS mode with given threshold
      v = vec(Vec3, { graduateAt })
      // Pre-push (graduateAt - 1) items so the NEXT push triggers graduation
      for (let i = 0; i < graduateAt - 1; i++) {
        const h = v.push()
        h.x = i
        h.y = i * 2
        h.z = i * 3
      }
    },
    fn() {
      // This single push crosses the threshold and triggers graduation.
      // Cost = allocate TypedArrays + copy graduateAt items + codegen handle.
      const h = v.push()
      h.x = 999
      h.y = 999
      h.z = 999
      // Immediately reset to (graduateAt-1) so the NEXT fn() call starts in JS mode.
      // Note: graduation is one-way — after graduation, pop back and recreate in JS mode.
      v.drop()
      // Re-create for the next iteration
      v = vec(Vec3, { graduateAt })
      for (let i = 0; i < graduateAt - 1; i++) {
        const h2 = v.push()
        h2.x = i
        h2.y = i * 2
        h2.z = i * 3
      }
    },
    iterations: 500,
    warmup: 50,
  }
}

// JS baseline: cost of creating an array of (graduateAt) JS objects
function makeJsBaseline(graduateAt: number): Scenario {
  return {
    name: `B10-graduation JS baseline N=${graduateAt}`,
    setup() {},
    fn() {
      const arr: { x: number; y: number; z: number }[] = new Array(graduateAt)
      for (let i = 0; i < graduateAt; i++) {
        arr[i] = { x: i, y: i * 2, z: i * 3 }
      }
    },
    iterations: 500,
    warmup: 50,
  }
}

export const b10Scenarios: Scenario[] = [
  makeJsBaseline(128),
  makeGraduationScenario(128),
  makeJsBaseline(256),
  makeGraduationScenario(256),
]
