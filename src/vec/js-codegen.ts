import type { StructFields } from '../types.js'
import { isNumericType } from '../struct/layout.js'

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
