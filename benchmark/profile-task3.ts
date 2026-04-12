/**
 * profile-task3.ts
 *
 * Micro-profiler for task-3: breaks down sub-operation costs for B1/B2 slab and vec.
 * Uses Bun.nanoseconds() timers to isolate: free-list pop, bitmap set, handle rebase,
 * field writes, column writes (swapRemove), and guard checks.
 *
 * Run with: bun run benchmark/profile-task3.ts
 */

import { struct, slab, vec } from '../src/index.js'
import { bitmapByteLength, bitmapSet, bitmapClear, bitmapGet } from '../src/slab/bitmap.js'

const WARMUP = 3
const ITERS = 20
const N = 100_000
const N_CHURN = 10_000

// ---------------------------------------------------------------------------
// Helper: measure a tight loop N_CALLS times, return avg ns per call
// ---------------------------------------------------------------------------
function measureOp(label: string, iters: number, warmup: number, fn: () => void): number {
  // Warmup
  for (let w = 0; w < warmup; w++) fn()

  const samples: number[] = []
  for (let i = 0; i < iters; i++) {
    const t0 = Bun.nanoseconds()
    fn()
    const t1 = Bun.nanoseconds()
    samples.push(t1 - t0)
  }

  samples.sort((a, b) => a - b)
  const p50 = samples[Math.floor(iters * 0.5)]!
  const p99 = samples[Math.floor(iters * 0.99)]!
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length

  console.log(`  ${label}: avg=${(avg / 1e6).toFixed(2)}ms p50=${(p50 / 1e6).toFixed(2)}ms p99=${(p99 / 1e6).toFixed(2)}ms`)
  return avg
}

// ---------------------------------------------------------------------------
// B1-slab: breakdown of slab.insert() sub-operations
// ---------------------------------------------------------------------------
console.log('\n=== B1-SLAB: slab.insert() sub-operation breakdown ===\n')

const Vec3 = struct({ x: 'f64', y: 'f64', z: 'f64' })

// Baseline: full insert
measureOp('Full slab insert (100k, no field write)', ITERS, WARMUP, () => {
  const s = slab(Vec3, N)
  for (let i = 0; i < N; i++) s.insert()
  s.drop()
})

measureOp('Full slab insert + 3 field writes (100k)', ITERS, WARMUP, () => {
  const s = slab(Vec3, N)
  for (let i = 0; i < N; i++) {
    const h = s.insert()
    h.x = i
    h.y = i
    h.z = i
  }
  s.drop()
})

// Isolate: free-list pop only (Uint32Array stack)
measureOp('Free-list pop only (100k Uint32Array reads)', ITERS, WARMUP, () => {
  const fl = new Uint32Array(N)
  for (let i = 0; i < N; i++) fl[i] = N - 1 - i
  let top = N
  let sum = 0
  for (let i = 0; i < N; i++) {
    sum += fl[--top]!
  }
  // Prevent dead-code elimination
  if (sum < 0) throw new Error('unreachable')
})

// Isolate: bitmap set only
measureOp('Bitmap set only (100k bit sets)', ITERS, WARMUP, () => {
  const bits = new Uint8Array(bitmapByteLength(N))
  for (let i = 0; i < N; i++) bitmapSet(bits, i)
})

// Isolate: handle rebase only
{
  const s = slab(Vec3, N)
  const h = s.insert()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyH = h as any
  measureOp('Handle _rebase only (100k calls)', ITERS, WARMUP, () => {
    for (let i = 0; i < N; i++) anyH._rebase(i % N)
  })
  s.drop()
}

// Isolate: 3x TypedArray writes
{
  const xArr = new Float64Array(N)
  const yArr = new Float64Array(N)
  const zArr = new Float64Array(N)
  measureOp('3x TypedArray writes (100k, direct)', ITERS, WARMUP, () => {
    for (let i = 0; i < N; i++) {
      xArr[i] = i
      yArr[i] = i
      zArr[i] = i
    }
  })
}

// Isolate: slab constructor only (no inserts)
measureOp('slab() constructor (create + drop, 100 times)', ITERS, WARMUP, () => {
  for (let k = 0; k < 100; k++) {
    const s = slab(Vec3, N)
    s.drop()
  }
})

// Isolate: struct() call cost
measureOp('struct() call (1000 times)', ITERS, WARMUP, () => {
  for (let k = 0; k < 1000; k++) {
    struct({ x: 'f64', y: 'f64', z: 'f64' })
  }
})

// JS baseline: object creation
measureOp('JS object creation (100k {x,y,z})', ITERS, WARMUP, () => {
  const arr = new Array(N)
  for (let i = 0; i < N; i++) arr[i] = { x: i, y: i, z: i }
})

// ---------------------------------------------------------------------------
// B1-vec: breakdown of vec.push() sub-operations
// ---------------------------------------------------------------------------
console.log('\n=== B1-VEC: vec.push() sub-operation breakdown ===\n')

// Full push with growth (starting from capacity 16)
measureOp('Full vec push (100k, start cap=16, with growth)', ITERS, WARMUP, () => {
  const v = vec(Vec3, 16)
  for (let i = 0; i < N; i++) {
    const h = v.push()
    h.x = i
    h.y = i
    h.z = i
  }
  v.drop()
})

// Full push without growth (pre-reserved capacity)
measureOp('Full vec push (100k, pre-reserved, no growth)', ITERS, WARMUP, () => {
  const v = vec(Vec3, N)
  for (let i = 0; i < N; i++) {
    const h = v.push()
    h.x = i
    h.y = i
    h.z = i
  }
  v.drop()
})

// Growth-only cost: how much does growth add?
measureOp('Vec growth cost: push 100k (cap=16) vs no-growth (cap=100k) delta', ITERS, WARMUP, () => {
  // This is the grow() path cost
  const v = vec(Vec3, 16)
  while (v.len < N) v.push()
  v.drop()
})

// Isolate: plain len/capacity checks without actual work
{
  const v = vec(Vec3, N)
  for (let i = 0; i < N; i++) v.push()
  measureOp('Vec get() (100k indexed reads, no growth)', ITERS, WARMUP, () => {
    for (let i = 0; i < N; i++) v.get(i)
  })
  v.drop()
}

// ---------------------------------------------------------------------------
// B2-slab: insert/remove churn sub-operation breakdown
// ---------------------------------------------------------------------------
console.log('\n=== B2-SLAB: insert/remove churn breakdown ===\n')

const slots = new Int32Array(N_CHURN)

// Full churn cycle
measureOp('Full slab churn (10k insert+remove)', ITERS * 5, WARMUP * 5, () => {
  const s = slab(Vec3, N_CHURN)
  for (let i = 0; i < N_CHURN; i++) {
    const h = s.insert()
    h.x = i; h.y = i; h.z = 0
    slots[i] = h.slot
  }
  for (let i = 0; i < N_CHURN; i++) s.remove(slots[i]!)
  s.drop()
})

// Insert only
measureOp('Slab insert only (10k)', ITERS * 5, WARMUP * 5, () => {
  const s = slab(Vec3, N_CHURN)
  for (let i = 0; i < N_CHURN; i++) {
    const h = s.insert()
    h.x = i; h.y = i; h.z = 0
    slots[i] = h.slot
  }
  s.drop()
})

// Remove only (pre-insert a fresh slab before each remove cycle)
{
  const s2 = slab(Vec3, N_CHURN)
  measureOp('Slab remove only (10k, post-full-insert)', ITERS * 5, WARMUP * 5, () => {
    // Re-insert each time
    s2.clear()
    for (let i = 0; i < N_CHURN; i++) {
      const h = s2.insert()
      slots[i] = h.slot
    }
    for (let i = 0; i < N_CHURN; i++) s2.remove(slots[i]!)
  })
  s2.drop()
}

// Isolate: bitmap get (remove validation check)
measureOp('Bitmap get check only (10k checks)', ITERS * 5, WARMUP * 5, () => {
  const bits = new Uint8Array(bitmapByteLength(N_CHURN))
  for (let i = 0; i < N_CHURN; i++) bitmapSet(bits, i)
  let sum = 0
  for (let i = 0; i < N_CHURN; i++) {
    if (bitmapGet(bits, i)) sum++
  }
  if (sum !== N_CHURN) throw new Error('unreachable')
})

// Isolate: Number.isInteger + bounds check (remove guard)
measureOp('Remove guard (Number.isInteger + bounds, 10k)', ITERS * 5, WARMUP * 5, () => {
  let sum = 0
  for (let i = 0; i < N_CHURN; i++) {
    if (Number.isInteger(i) && i >= 0 && i < N_CHURN) sum++
  }
  if (sum !== N_CHURN) throw new Error('unreachable')
})

// JS baseline churn
{
  const jsPool = new Array<{ x: number; y: number; z: number } | null>(N_CHURN).fill(null)
  const jsFree = Array.from({ length: N_CHURN }, (_, i) => N_CHURN - 1 - i)
  measureOp('JS baseline churn (10k insert+remove)', ITERS * 5, WARMUP * 5, () => {
    for (let i = 0; i < N_CHURN; i++) {
      const slot = jsFree.pop()!
      jsPool[slot] = { x: i, y: i, z: 0 }
    }
    for (let i = 0; i < N_CHURN; i++) {
      jsPool[i] = null
      jsFree.push(i)
    }
  })
}

// ---------------------------------------------------------------------------
// B2-vec: push/swapRemove churn breakdown
// ---------------------------------------------------------------------------
console.log('\n=== B2-VEC: push/swapRemove churn breakdown ===\n')

// Full vec churn
{
  const v = vec(Vec3, N_CHURN)
  const half = N_CHURN / 2
  for (let i = 0; i < half; i++) { const h = v.push(); h.x = i; h.y = i; h.z = 0 }

  measureOp('Full vec churn (5k push+5k swapRemove(0))', ITERS * 5, WARMUP * 5, () => {
    for (let i = 0; i < half; i++) {
      const h = v.push()
      h.x = i; h.y = i; h.z = 0
    }
    for (let i = 0; i < half; i++) v.swapRemove(0)
  })
  v.drop()
}

// swapRemove only (index 0 vs last)
{
  const v1 = vec(Vec3, N_CHURN)
  for (let i = 0; i < N_CHURN; i++) { const h = v1.push(); h.x = i; h.y = i; h.z = 0 }
  measureOp('swapRemove(last) only 10k (no copy)', ITERS * 5, WARMUP * 5, () => {
    // Refill
    while (v1.len < N_CHURN) v1.push()
    for (let i = 0; i < N_CHURN; i++) v1.swapRemove(v1.len - 1)
  })
  v1.drop()
}

{
  const v2 = vec(Vec3, N_CHURN)
  for (let i = 0; i < N_CHURN; i++) { const h = v2.push(); h.x = i; h.y = i; h.z = 0 }
  measureOp('swapRemove(0) only 10k (max copy)', ITERS * 5, WARMUP * 5, () => {
    while (v2.len < N_CHURN) v2.push()
    for (let i = 0; i < N_CHURN; i++) v2.swapRemove(0)
  })
  v2.drop()
}

// Isolate: Map.get() overhead inside swapRemove (columnMap lookup)
{
  const colMap = new Map<string, Float64Array>()
  const xArr = new Float64Array(N_CHURN)
  const yArr = new Float64Array(N_CHURN)
  const zArr = new Float64Array(N_CHURN)
  colMap.set('x', xArr); colMap.set('y', yArr); colMap.set('z', zArr)

  measureOp('3x Map.get() per element (10k iters = 30k total lookups)', ITERS * 5, WARMUP * 5, () => {
    for (let i = 0; i < N_CHURN; i++) {
      const last = N_CHURN - 1 - i
      colMap.get('x')![0] = colMap.get('x')![last]!
      colMap.get('y')![0] = colMap.get('y')![last]!
      colMap.get('z')![0] = colMap.get('z')![last]!
    }
  })
}

// Direct TypedArray writes (no Map lookup) for comparison
{
  const xArr = new Float64Array(N_CHURN)
  const yArr = new Float64Array(N_CHURN)
  const zArr = new Float64Array(N_CHURN)

  measureOp('3x direct TypedArray writes (10k iters, no Map lookup)', ITERS * 5, WARMUP * 5, () => {
    for (let i = 0; i < N_CHURN; i++) {
      const last = N_CHURN - 1 - i
      xArr[0] = xArr[last]!
      yArr[0] = yArr[last]!
      zArr[0] = zArr[last]!
    }
  })
}

// ---------------------------------------------------------------------------
// forEach vs get(i) comparison
// ---------------------------------------------------------------------------
console.log('\n=== B3-SLAB: forEach vs get(i) comparison ===\n')

{
  const s = slab(Vec3, N)
  for (let i = 0; i < N; i++) {
    const h = s.insert()
    h.x = i; h.y = i; h.z = i
  }

  measureOp('slab.forEach (100k, read x+y+z sum)', ITERS, WARMUP, () => {
    let sum = 0
    s.forEach((h) => { sum += h.x + h.y + h.z })
    if (sum < 0) throw new Error('unreachable')
  })

  measureOp('slab.get(i) loop (100k, read x+y+z sum)', ITERS, WARMUP, () => {
    let sum = 0
    for (let i = 0; i < N; i++) {
      const h = s.get(i)
      sum += h.x + h.y + h.z
    }
    if (sum < 0) throw new Error('unreachable')
  })

  // Column direct access (no handle)
  const xCol = s.column('x')
  const yCol = s.column('y')
  const zCol = s.column('z')
  measureOp('Direct column read (100k, no handle)', ITERS, WARMUP, () => {
    let sum = 0
    for (let i = 0; i < N; i++) {
      sum += xCol[i]! + yCol[i]! + zCol[i]!
    }
    if (sum < 0) throw new Error('unreachable')
  })

  // Callback overhead (empty callback)
  measureOp('forEach with empty callback (100k)', ITERS, WARMUP, () => {
    s.forEach(() => {})
  })

  // Isolate rebase per slot (use existing handle, don't insert again)
  const hForRebase = s.get(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyH = hForRebase as any
  measureOp('Rebase + read x+y+z (100k, no callback overhead)', ITERS, WARMUP, () => {
    let sum = 0
    for (let i = 0; i < N; i++) {
      anyH._rebase(i)
      sum += anyH.x + anyH.y + anyH.z
    }
    if (sum < 0) throw new Error('unreachable')
  })

  s.drop()
}

console.log('\n=== Profiling complete ===\n')
