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
 * A factory function that accepts column TypedArrays (in layout order) and
 * returns a SoAHandleConstructor with those columns baked into its closure.
 *
 * This is the cacheable part — it is derived from struct layout only and
 * can be reused across all container instances that share the same StructDef.
 * Call it with the current column TypedArrays to get a fresh handle class
 * whose closures capture those specific arrays.
 *
 * Internal — not part of the public contract.
 */
export type SoAHandleFactory = (...columnArrays: unknown[]) => SoAHandleConstructor

/**
 * Sanitizes a dotted column name into a valid JS identifier suffix.
 * Rule: replace '.' with '_'. E.g. 'pos.x' → 'pos_x', 'life' → 'life'.
 * Used to derive instance field names: '_c_pos_x', '_c_life', etc.
 */
function sanitizeColumnName(name: string): string {
  return name.replace(/\./g, '_')
}

/**
 * Recursively generates the SoA handle class *factory* for one level of the
 * handle tree.
 *
 * Unlike `generateSoAHandleClass`, this function calls `new Function()` exactly
 * once per handle-tree node and returns a factory:
 *
 *   `(...columnArrays) => SoAHandleConstructor`
 *
 * The factory's parameter list contains only the leaf column TypedArrays for
 * this subtree (in depth-first, declaration order). Child constructors are
 * resolved recursively and **baked into** the outer factory closure via an
 * immediately-called inner factory — they are NOT re-passed on every call.
 *
 * This means the factory itself is layout-dependent only and can be cached on
 * the StructDef (see `StructDef._SoAHandleFactory`). Callers pass the current
 * column TypedArrays to the factory to obtain a handle constructor whose
 * getters/setters access those specific arrays.
 *
 * Column order in the factory parameter list matches the order of
 * `node.numericFields` at each level, collected via a pre-order DFS:
 *   - Sub-handle columns first (recursively), then this node's own numeric columns.
 *   This is the same order as the flat `columnRefs` argument list used when
 *   calling the factory.
 *
 * @param node  The HandleNode describing fields at this level.
 * @returns     A factory `(...columnArrays) => SoAHandleConstructor`.
 */
export function generateSoAHandleFactory(node: HandleNode): SoAHandleFactory {
  // Recursively generate child factories and snapshot their child constructors.
  // The child constructors are baked into the outer factory by having the outer
  // new Function() call them immediately — not re-passed on every factory call.
  const subHandles = node.nestedFields.map(({ name, child }) => {
    const childFactory = generateSoAHandleFactory(child)
    return { name, childFactory, childParamName: `_C_${name}` }
  })

  // Collect numeric entries — their instance field names become the factory params.
  const numericEntries = node.numericFields.map(({ name, column }) => {
    const dotted = column.name  // fully qualified dotted key, e.g. 'pos.x'
    const instanceField = `_c_${sanitizeColumnName(dotted)}`
    return { fieldName: name, dotted, instanceField }
  })

  // --- Factory parameter list (layout-only, no TypedArray instances) ---
  // Only the leaf column TypedArrays for this subtree are parameters.
  // Child constructors are produced by the child factories; they are wired in
  // by the outer factory body itself (see factoryBody below).
  const paramNames: string[] = numericEntries.map(e => e.instanceField)

  // --- Constructor body ---
  let ctorBody = `this._slot=s;\n`
  for (const { instanceField } of numericEntries) {
    ctorBody += `this.${instanceField}=${instanceField};\n`
  }
  for (const { name, childParamName } of subHandles) {
    ctorBody += `this._sub_${name}=new ${childParamName}(s);\n`
  }

  // --- _rebase method ---
  let rebaseBody = `this._slot=s;\n`
  for (const { name } of subHandles) {
    rebaseBody += `this._sub_${name}._rebase(s);\n`
  }
  rebaseBody += `return this;\n`

  // --- Public slot getter ---
  const slotGetterBody = `get slot(){return this._slot}\n`

  // --- Field accessors ---
  let accessorBody = ''
  for (const { fieldName, instanceField } of numericEntries) {
    accessorBody += `get ${fieldName}(){return this.${instanceField}[this._slot]}\n`
    accessorBody += `set ${fieldName}(v){this.${instanceField}[this._slot]=v}\n`
  }
  for (const { name } of subHandles) {
    accessorBody += `get ${name}(){return this._sub_${name}}\n`
  }

  // --- Build the inner class-returning function body ---
  // The inner function takes only column TypedArrays (paramNames).
  // Child constructors (_C_<name>) are referenced as outer parameters.
  const innerFnParams = paramNames.length > 0 ? paramNames.join(',') : ''
  const innerFnBody = [
    `return class Handle{`,
    `constructor(s){${ctorBody}}`,
    `_rebase(s){${rebaseBody}}`,
    slotGetterBody,
    accessorBody,
    `}`,
  ].join('\n')

  if (subHandles.length === 0) {
    // No nested structs: the factory is simply the new Function() itself.
    // Factory params = column TypedArrays. Returns a handle class.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional codegen; runs once per StructDef
    const factory = new Function(innerFnParams, innerFnBody) as SoAHandleFactory
    return factory
  }

  // --- With nested structs: wrap in an outer factory that bakes child ctors ---
  // The outer factory captures child constructors in its closure by calling each
  // child factory with dummy arrays. Wait — we need to pass real arrays to get
  // a real child constructor.
  //
  // The correct design: the OUTER factory also needs to receive column arrays,
  // split them to sub-factories, then call the inner function with the remainder.
  //
  // We track column counts per sub-tree so we can slice the flat args list.
  //
  // Column order convention (pre-order DFS, declaration order):
  //   for each nestedField in order: collect all columns of that subtree
  //   then: this node's own numericFields
  //
  // The factory returned here accepts columns in this flat order.

  // Count how many columns each child subtree has (recursively).
  // We can compute this from the child HandleNode.
  function countLeafColumns(n: HandleNode): number {
    let count = n.numericFields.length
    for (const { child } of n.nestedFields) {
      count += countLeafColumns(child)
    }
    return count
  }

  const childColumnCounts = subHandles.map(({ name: _name, childFactory: _cf }) => {
    // Find the matching nestedField to get the child node.
    const nestedField = node.nestedFields.find(nf => `_C_${nf.name}` === `_C_${_name}`)!
    return countLeafColumns(nestedField.child)
  })

  const totalParams = childColumnCounts.reduce((a, b) => a + b, 0) + numericEntries.length

  // Build a flat-arg factory:
  //   (...allColumns) => SoAHandleConstructor
  // where allColumns = [child0cols..., child1cols..., ..., thisLevelCols...]
  //
  // We do this via a JavaScript closure that:
  //   1. Slices the args to extract each child's columns.
  //   2. Calls each child factory with its slice to get the child ctor.
  //   3. Calls the inner function (class factory) with the remaining own columns.
  //
  // Since we cannot use spread on `arguments` efficiently in strict mode,
  // we generate another new Function() for the outer wrapper — but this is still
  // called only once at factory-generation time (when the StructDef is first used).

  const outerParams = Array.from({ length: totalParams }, (_, i) => `_a${i}`).join(',')
  let outerBody = ''
  let argIdx = 0
  const childCtorVars: string[] = []
  for (let i = 0; i < subHandles.length; i++) {
    const count = childColumnCounts[i]!
    const childArgs = Array.from({ length: count }, (_, j) => `_a${argIdx + j}`).join(',')
    argIdx += count
    const childCtorVar = `_cc${i}`
    childCtorVars.push(childCtorVar)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    outerBody += `var ${childCtorVar}=_childFactories[${i}](${childArgs});\n`
  }
  // Remaining args are this node's own column arrays.
  const ownArgs = Array.from({ length: numericEntries.length }, (_, j) => `_a${argIdx + j}`).join(',')

  // Re-assemble the inner class body, but now the child ctor params (_C_<name>)
  // are the childCtorVars instead of outer params.
  // We need to substitute child param names. Easiest: rebuild ctorBody with child ctor vars.
  let ctorBody2 = `this._slot=s;\n`
  for (const { instanceField } of numericEntries) {
    ctorBody2 += `this.${instanceField}=${instanceField};\n`
  }
  for (let i = 0; i < subHandles.length; i++) {
    ctorBody2 += `this._sub_${subHandles[i]!.name}=new ${childCtorVars[i]}(s);\n`
  }

  let accessorBody2 = ''
  for (const { fieldName, instanceField } of numericEntries) {
    accessorBody2 += `get ${fieldName}(){return this.${instanceField}[this._slot]}\n`
    accessorBody2 += `set ${fieldName}(v){this.${instanceField}[this._slot]=v}\n`
  }
  for (const { name } of subHandles) {
    accessorBody2 += `get ${name}(){return this._sub_${name}}\n`
  }

  const innerBody2 = [
    `return class Handle{`,
    `constructor(s){${ctorBody2}}`,
    `_rebase(s){${rebaseBody}}`,
    slotGetterBody,
    accessorBody2,
    `}`,
  ].join('\n')

  const innerFnParams2 = numericEntries.map(e => e.instanceField).join(',')

  outerBody += `return (function(${innerFnParams2}){\n${innerBody2}\n})(${ownArgs});\n`

  // The outer factory captures _childFactories via a wrapping IIFE-style approach:
  // we create a function that takes _childFactories as closure and returns the
  // actual factory that takes flat column args.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional codegen; runs once per StructDef
  const makeOuterFactory = new Function(
    '_childFactories',
    `return function factory(${outerParams}){\n${outerBody}}`,
  ) as (childFactories: SoAHandleFactory[]) => SoAHandleFactory

  const childFactoriesList = subHandles.map(s => s.childFactory)
  return makeOuterFactory(childFactoriesList)
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
 * This is a convenience wrapper around `generateSoAHandleFactory` that accepts
 * the current column refs map and immediately calls the factory to get a handle
 * constructor.
 *
 * @param node        The HandleNode describing fields at this level.
 * @param columnRefs  Map from dotted column name to ColumnRef (TypedArray + name).
 */
export function generateSoAHandleClass(
  node: HandleNode,
  columnRefs: ReadonlyMap<string, ColumnRef>,
): SoAHandleConstructor {
  const factory = generateSoAHandleFactory(node)
  const columnArgs = buildColumnArgs(node, columnRefs)
  return factory(...columnArgs)
}

/**
 * Build the flat ordered list of column TypedArrays for a handle tree node.
 *
 * Order: pre-order DFS — for each nestedField collect its subtree columns first,
 * then this node's own numericFields. This matches the parameter order of the
 * factory returned by generateSoAHandleFactory.
 *
 * @param node        The HandleNode to collect columns for.
 * @param columnRefs  Map from dotted column name to ColumnRef.
 * @returns           Ordered array of TypedArray instances.
 */
export function buildColumnArgs(
  node: HandleNode,
  columnRefs: ReadonlyMap<string, ColumnRef>,
): unknown[] {
  const args: unknown[] = []

  // Sub-tree columns first (pre-order DFS over nestedFields).
  for (const { child } of node.nestedFields) {
    const childArgs = buildColumnArgs(child, columnRefs)
    args.push(...childArgs)
  }

  // Then this node's own numeric columns.
  for (const { column } of node.numericFields) {
    const dotted = column.name
    const ref = columnRefs.get(dotted)
    if (ref === undefined) {
      throw new Error(`buildColumnArgs: no column ref found for '${dotted}'`)
    }
    args.push(ref.array)
  }

  return args
}

/**
 * Re-export ColumnDesc and HandleNode so callers only need to import from handle-codegen.ts.
 * Internal — not part of the public contract.
 */
export type { ColumnDesc, HandleNode }
