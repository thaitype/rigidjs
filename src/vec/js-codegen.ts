import type { StructFields } from '../types.js'
import { isNumericType } from '../struct/layout.js'
import type { ColumnRef } from '../struct/handle-codegen.js'

// ---------------------------------------------------------------------------
// JS mode codegen (milestone-7 task-2)
// ---------------------------------------------------------------------------
//
// Two generated artifacts:
//   1. createObjectFactory — a `() => object` factory that creates plain JS
//      objects with all fields initialized in declaration order. Every call
//      produces an object with the same hidden class → monomorphic JIT path.
//
//   2. generateJSHandleClass — a handle class that wraps a plain JS object
//      and exposes the same getter/setter interface as SoA handles.
//
// Both use `new Function()` — same technique as handle-codegen.ts — so the
// generated code is specialised at vec() call time and not per-operation.
// ---------------------------------------------------------------------------

/**
 * Builds the initialiser literal for one level of struct fields.
 * Numeric fields → `0`, nested StructDef fields → `{ ... }` recursively.
 *
 * @example
 * buildObjectLiteral({ pos: Vec3, life: 'f32', id: 'u32' })
 * // "{ pos: { x: 0, y: 0, z: 0 }, life: 0, id: 0 }"
 */
function buildObjectLiteral(fields: StructFields): string {
  const parts: string[] = []

  for (const key of Object.keys(fields)) {
    const fieldType = fields[key]!
    if (isNumericType(fieldType)) {
      parts.push(`${key}:0`)
    } else {
      // Nested StructDef — recurse into its fields
      parts.push(`${key}:${buildObjectLiteral(fieldType.fields)}`)
    }
  }

  return `{${parts.join(',')}}`
}

/**
 * Generate a factory function that produces plain JS objects with a stable
 * hidden class (all fields initialized in declaration order).
 *
 * Uses `new Function()` so the literal is baked at call time, not per-push.
 *
 * @param fields  The struct field map (from StructDef.fields).
 * @returns       A zero-argument factory: `() => object`.
 */
export function generateJSObjectFactory(fields: StructFields): () => object {
  const literal = buildObjectLiteral(fields)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional codegen
  const factory = new Function(`return function createObject(){return ${literal}}`)
  return (factory as () => () => object)()
}

// ---------------------------------------------------------------------------
// JSHandle codegen
// ---------------------------------------------------------------------------

/**
 * The constructor shape of a generated JS handle class.
 * Internal — not part of the public contract.
 */
export interface JSHandleConstructor {
  new (obj: object): object
}

/**
 * Recursively builds the JSHandle class body for one level of struct fields.
 *
 * Each class:
 *  - `_obj` — the wrapped JS object reference
 *  - `_slot` — the current index in _items (set by _rebase)
 *  - `_rebase(obj, slot)` — point at a different JS object
 *  - Getter/setter per numeric field: `get x() { return this._obj.x }`
 *  - Getter per nested field: `get pos() { return this._sub_pos }` where
 *    `_sub_pos` is a sub-JSHandle pre-built in the constructor
 *  - Sub-handle `_rebase` is called on parent `_rebase` so nested handles stay
 *    in sync without extra allocations
 *
 * @param fields      The struct field map at this level.
 * @param objPath     The property access chain from the top-level `_obj`,
 *                    e.g. '' for root, 'pos' for a nested struct named 'pos'.
 *                    Used to build the access expression inside getters/setters.
 * @param subHandles  Accumulator for sub-handle entries (name + ChildCtor).
 */
function buildJSHandleClassBody(
  fields: StructFields,
  objPath: string,
): string {
  // objPath is '' at root, 'pos' for a nested field, 'pos.vel' for double-nested, etc.
  // The _obj access expression at this level: 'this._obj' at root, 'this._obj.pos' for pos.
  const objExpr = objPath.length === 0 ? 'this._obj' : `this._obj.${objPath}`

  let ctorBody = ''
  let rebaseBody = ''
  let accessorBody = ''
  const childClasses: Array<{ name: string; paramName: string; childPath: string; childFields: StructFields }> = []

  for (const key of Object.keys(fields)) {
    const fieldType = fields[key]!
    if (isNumericType(fieldType)) {
      // Leaf numeric field — direct property access on the JS object
      const path = objPath.length === 0 ? key : `${objPath}.${key}`
      accessorBody += `get ${key}(){return this._obj.${path}}\n`
      accessorBody += `set ${key}(v){this._obj.${path}=v}\n`
    } else {
      // Nested struct — create a sub-handle
      const childPath = objPath.length === 0 ? key : `${objPath}.${key}`
      const paramName = `_C_${key}`
      childClasses.push({ name: key, paramName, childPath, childFields: fieldType.fields })
      ctorBody += `this._sub_${key}=new ${paramName}(obj);\n`
      rebaseBody += `this._sub_${key}._rebase(obj);\n`
      accessorBody += `get ${key}(){return this._sub_${key}}\n`
    }
  }

  return JSON.stringify({ ctorBody, rebaseBody, accessorBody, childClasses })
}

/**
 * Recursively generate a JSHandle class for one level of the struct hierarchy.
 *
 * @param fields  The struct field map at this level.
 * @param path    Dotted property path from the top-level _obj to this level's
 *                object reference, e.g. '' for root, 'pos' for a nested struct.
 */
function generateJSHandleLevel(
  fields: StructFields,
  path: string,
): JSHandleConstructor {
  // Collect child handle constructors for nested struct fields
  const childEntries: Array<{ name: string; Ctor: JSHandleConstructor }> = []
  for (const key of Object.keys(fields)) {
    const fieldType = fields[key]!
    if (!isNumericType(fieldType)) {
      const childPath = path.length === 0 ? key : `${path}.${key}`
      const ChildCtor = generateJSHandleLevel(fieldType.fields, childPath)
      childEntries.push({ name: key, Ctor: ChildCtor })
    }
  }

  // Build parameter list for the factory: one param per child ctor
  const paramNames = childEntries.map(e => `_C_${e.name}`)

  // Constructor body
  let ctorBody = 'this._obj=obj;\nthis._slot=0;\n'
  // Rebase body
  let rebaseBody = 'this._obj=obj;\n'
  // Accessor body
  let accessorBody = ''

  for (const key of Object.keys(fields)) {
    const fieldType = fields[key]!
    if (isNumericType(fieldType)) {
      // The path from root _obj to this field
      const fieldPath = path.length === 0 ? key : `${path}.${key}`
      accessorBody += `get ${key}(){return this._obj.${fieldPath}}\n`
      accessorBody += `set ${key}(v){this._obj.${fieldPath}=v}\n`
    } else {
      ctorBody += `this._sub_${key}=new _C_${key}(obj);\n`
      rebaseBody += `this._sub_${key}._rebase(obj);\n`
      accessorBody += `get ${key}(){return this._sub_${key}}\n`
    }
  }

  rebaseBody += 'return this;\n'

  // Slot getter — only meaningful on the root handle
  const slotGetter = 'get slot(){return this._slot}\n'

  const factoryParams = paramNames.length > 0 ? paramNames.join(',') : ''
  const factoryBody = [
    'return class JSHandle{',
    `constructor(obj){${ctorBody}}`,
    `_rebase(obj){${rebaseBody}}`,
    slotGetter,
    accessorBody,
    '}',
  ].join('\n')

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional codegen, same pattern as handle-codegen.ts
  const factory = new Function(factoryParams, factoryBody) as (...args: unknown[]) => JSHandleConstructor

  const factoryArgs = childEntries.map(e => e.Ctor)
  return factory(...factoryArgs)
}

/**
 * Generate a JSHandle class for the given struct field map.
 *
 * The generated class:
 *  - Constructor takes a plain JS object.
 *  - `_rebase(obj)` rebases to a different JS object (for handle reuse).
 *  - `_slot` tracks the current index in the _items array.
 *  - Getters/setters provide direct property access on the wrapped object.
 *  - Nested struct fields expose sub-handles with the same interface.
 *
 * @param fields  The struct field map (from StructDef.fields).
 * @returns       A JSHandleConstructor.
 */
export function generateJSHandleClass(fields: StructFields): JSHandleConstructor {
  return generateJSHandleLevel(fields, '')
}

// ---------------------------------------------------------------------------
// Copy-to-columns codegen (milestone-7 task-3)
// ---------------------------------------------------------------------------

/**
 * Recursively collects all leaf field paths for the copy-to-columns function.
 * Returns an array of dotted paths like ['pos.x', 'pos.y', 'vel.x', 'life', 'id'].
 */
function collectLeafPaths(fields: StructFields, prefix: string): string[] {
  const paths: string[] = []
  for (const key of Object.keys(fields)) {
    const fieldType = fields[key]!
    const path = prefix.length === 0 ? key : `${prefix}.${key}`
    if (isNumericType(fieldType)) {
      paths.push(path)
    } else {
      paths.push(...collectLeafPaths(fieldType.fields, path))
    }
  }
  return paths
}

/**
 * Generate a codegen'd function that copies all data from a JS object array
 * into TypedArray columns efficiently.
 *
 * Generated form (example for struct({ x: 'f64', y: 'f64', pos: { x: 'f64' } })):
 * ```javascript
 * function copyToColumns(items, len, col_x, col_y, col_pos_x) {
 *   for (let i = 0; i < len; i++) {
 *     const o = items[i];
 *     col_x[i] = o.x;
 *     col_y[i] = o.y;
 *     col_pos_x[i] = o.pos.x;
 *   }
 * }
 * ```
 *
 * Uses `new Function()` — generated once at graduation time (not per-call).
 * The column TypedArrays are passed as arguments and captured in the loop body.
 *
 * @param fields     The struct fields (from StructDef.fields).
 * @param columnRefs Map from dotted column name to ColumnRef containing the TypedArray.
 * @returns          A function `(items: object[], len: number) => void` that copies data.
 */
export function generateCopyToColumnsFn(
  fields: StructFields,
  columnRefs: ReadonlyMap<string, ColumnRef>,
): (items: object[], len: number) => void {
  // Collect all leaf paths in declaration order (matching how they appear in the struct).
  const leafPaths = collectLeafPaths(fields, '')

  if (leafPaths.length === 0) {
    return function noopCopy(_items: object[], _len: number): void {}
  }

  // Build parameter names: col_pos_x, col_vel_y, etc. (dots replaced by underscores)
  const colParamNames = leafPaths.map(p => `col_${p.replace(/\./g, '_')}`)

  // Factory params = one TypedArray per column. Factory returns the inner copy function.
  const factoryParams = colParamNames.join(', ')

  // Build inner loop body — one assignment per column
  let loopBody = '    const o = items[i];\n'
  for (let i = 0; i < leafPaths.length; i++) {
    const path = leafPaths[i]!
    const paramName = colParamNames[i]!
    loopBody += `    ${paramName}[i] = o.${path};\n`
  }

  const fnBody = [
    'return function copyToColumns(items, len) {',
    '  for (let i = 0; i < len; i++) {',
    loopBody,
    '  }',
    '}',
  ].join('\n')

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional codegen, same pattern as handle-codegen.ts
  const factory = new Function(factoryParams, fnBody) as (...args: unknown[]) => (items: object[], len: number) => void

  // Resolve each column's TypedArray from columnRefs in the same order as leafPaths
  const columnArrays = leafPaths.map(path => {
    const ref = columnRefs.get(path)
    if (ref === undefined) {
      throw new Error(`generateCopyToColumnsFn: no column ref found for '${path}'`)
    }
    return ref.array
  })

  return factory(...columnArrays)
}
