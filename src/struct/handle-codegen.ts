import type { ColumnDesc, HandleNode } from './layout.js'

// ---------------------------------------------------------------------------
// SoA handle codegen (milestone-3)
// ---------------------------------------------------------------------------
// The old AoS + DataView generateHandleClass has been removed.
// Only the SoA TypedArray codegen path remains from milestone-3 onward.

/**
 * Descriptor for a TypedArray column reference used at SoA codegen time.
 * Internal — not part of the public contract.
 */
export interface ColumnRef {
  /** The dotted path to this column, e.g. 'pos.x'. Used as a lookup key. */
  name: string
  /** The concrete TypedArray instance to capture in the generated class. */
  array: Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array
}

/**
 * The constructor shape of a generated SoA handle class.
 * Internal — not part of the public contract.
 *
 * `slot` is the initial slot index; column TypedArrays are baked into the
 * closure at class-generation time, not passed at construction time.
 */
export interface SoAHandleConstructor {
  new (slot: number): object
}

/**
 * Sanitizes a dotted column name into a valid JS identifier suffix.
 * Rule: replace '.' with '_'. E.g. 'pos.x' → 'pos_x', 'life' → 'life'.
 * Used to derive instance field names: '_c_pos_x', '_c_life', etc.
 */
function sanitizeColumnName(name: string): string {
  return name.replace(/\./g, '_')
}

/**
 * Recursively generates the SoA handle class for one level of the handle tree.
 *
 * Each generated class:
 *  - Constructor takes `(s)` (initial slot). Column TypedArrays are captured via
 *    the new Function() closure, not passed at construction time.
 *  - Stores each column TypedArray as `this._c_<sanitized name>`.
 *  - Stores the slot as `this._slot`.
 *  - Constructs nested sub-handles in the constructor as `this._sub_<name>`.
 *  - Provides `_rebase(s)` that sets `this._slot = s` and recursively rebases
 *    each sub-handle. No DataView — column refs are constant for the lifetime of
 *    the containing slab.
 *  - Provides a public `get slot()` getter.
 *  - Emits one getter+setter pair per leaf numeric field with bodies that do
 *    pure TypedArray indexed access: no dispatch, no closures, no allocations.
 *
 * @param node        The HandleNode describing fields at this level.
 * @param columnRefs  Map from dotted column name to ColumnRef (TypedArray + name).
 */
export function generateSoAHandleClass(
  node: HandleNode,
  columnRefs: ReadonlyMap<string, ColumnRef>,
): SoAHandleConstructor {
  // Collect the column descriptors for all numeric fields at this level.
  // These are the TypedArrays that will be baked into the class closure.
  const numericEntries = node.numericFields.map(({ name, column }) => {
    const dotted = column.name  // fully qualified dotted key, e.g. 'pos.x'
    const ref = columnRefs.get(dotted)
    if (ref === undefined) {
      throw new Error(`generateSoAHandleClass: no column ref found for '${dotted}'`)
    }
    return { fieldName: name, dotted, instanceField: `_c_${sanitizeColumnName(dotted)}`, array: ref.array }
  })

  // Collect nested sub-handle classes (generated recursively) and their field names.
  // Each child class is passed as a named parameter to the outer factory function.
  const subHandles = node.nestedFields.map(({ name, child }) => {
    const ChildCtor = generateSoAHandleClass(child, columnRefs)
    return { name, ChildCtor, childParamName: `_C_${name}` }
  })

  // --- Build factory parameter list ---
  // Order: child constructors first, then column TypedArrays.
  // This mirrors the pattern in generateHandleClass for child ctors.
  const paramNames: string[] = [
    ...subHandles.map(s => s.childParamName),
    ...numericEntries.map(e => e.instanceField),
  ]

  // --- Constructor body ---
  // Assign each baked column ref to `this.<instanceField>` once.
  // Then construct sub-handles once per nested field.
  let ctorBody = `this._slot=s;\n`
  for (const { instanceField } of numericEntries) {
    // The column TypedArray is passed in via the factory closure parameter
    // of the same name as the instance field. Store it on `this`.
    ctorBody += `this.${instanceField}=${instanceField};\n`
  }
  for (const { name, childParamName } of subHandles) {
    ctorBody += `this._sub_${name}=new ${childParamName}(s);\n`
  }

  // --- _rebase method ---
  // Updates _slot and recursively rebases sub-handles.
  // No DataView refs to update — column arrays are constant.
  let rebaseBody = `this._slot=s;\n`
  for (const { name } of subHandles) {
    rebaseBody += `this._sub_${name}._rebase(s);\n`
  }
  rebaseBody += `return this;\n`

  // --- Public slot getter ---
  const slotGetterBody = `get slot(){return this._slot}\n`

  // --- Field accessors ---
  // Leaf numeric fields: pure TypedArray indexed access (zero allocation, monomorphic).
  // Nested struct fields: return pre-constructed sub-handle reference.
  let accessorBody = ''
  for (const { fieldName, instanceField } of numericEntries) {
    // Getter: return this._c_pos_x[this._slot]
    accessorBody += `get ${fieldName}(){return this.${instanceField}[this._slot]}\n`
    // Setter: this._c_pos_x[this._slot] = v
    accessorBody += `set ${fieldName}(v){this.${instanceField}[this._slot]=v}\n`
  }
  for (const { name } of subHandles) {
    // Nested struct field: return the pre-built sub-handle — zero allocation.
    accessorBody += `get ${name}(){return this._sub_${name}}\n`
  }

  // --- Assemble the factory function body ---
  const factoryParams = paramNames.length > 0 ? paramNames.join(',') : ''
  const factoryBody = [
    `return class Handle{`,
    `constructor(s){${ctorBody}}`,
    `_rebase(s){${rebaseBody}}`,
    slotGetterBody,
    accessorBody,
    `}`,
  ].join('\n')

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: codegen happens once at struct() call time
  const factory = new Function(factoryParams, factoryBody) as (...args: unknown[]) => SoAHandleConstructor

  // Pass child constructors first, then the actual TypedArray instances.
  const factoryArgs: unknown[] = [
    ...subHandles.map(s => s.ChildCtor),
    ...numericEntries.map(e => e.array),
  ]

  return factory(...factoryArgs)
}

/**
 * Re-export ColumnDesc and HandleNode so callers only need to import from handle-codegen.ts.
 * Internal — not part of the public contract.
 */
export type { ColumnDesc, HandleNode }
