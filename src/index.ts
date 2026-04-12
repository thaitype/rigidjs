export { struct } from './struct/struct.js'
export { slab } from './slab/slab.js'
export { vec } from './vec/vec.js'
export type { StructDef, StructFields, NumericType } from './types.js'
export type { Slab, Handle } from './slab/slab.js'
// milestone-3 type helpers — exported as type-only; the runtime method (slab.column())
// that uses them ships in task-3.
export type { ColumnKey, ColumnType } from './types.js'
// milestone-4 vec type
export type { Vec } from './vec/vec.js'
