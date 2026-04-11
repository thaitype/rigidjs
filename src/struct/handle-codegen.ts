import type { NumericType, StructFields } from '../types.js'
import { isNumericType } from './layout.js'

/**
 * DataView method names for each numeric type token.
 * Maps to get/set pairs used in generated handle getter/setter source.
 */
const DATAVIEW_METHODS: Record<NumericType, { get: string; set: string }> = {
  f64: { get: 'getFloat64', set: 'setFloat64' },
  f32: { get: 'getFloat32', set: 'setFloat32' },
  u32: { get: 'getUint32',  set: 'setUint32'  },
  u16: { get: 'getUint16',  set: 'setUint16'  },
  u8:  { get: 'getUint8',   set: 'setUint8'   },
  i32: { get: 'getInt32',   set: 'setInt32'   },
  i16: { get: 'getInt16',   set: 'setInt16'   },
  i8:  { get: 'getInt8',    set: 'setInt8'    },
}

/**
 * The type of a generated handle constructor produced by generateHandleClass.
 * Internal — not part of the public contract.
 */
export interface HandleConstructor {
  new (view: DataView, baseOffset: number, slot: number): object
}

/**
 * Descriptor for a nested struct field used during code generation.
 * Carries the field name, its byte offset within the parent struct,
 * and the child handle constructor (so the generated constructor can
 * instantiate exactly one sub-handle at construction time).
 *
 * Internal — not part of the public contract.
 */
interface NestedFieldDesc {
  name: string
  offset: number
  /** The handle constructor for the nested struct, produced by a prior generateHandleClass call. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque generated class, any is isolated here
  ChildHandle: new (view: DataView, baseOffset: number, slot: number) => any
}

/**
 * Generates a handle class via new Function() for a struct with optional nested fields.
 *
 * The generated class:
 *   - Stores DataView as `_v` and base offset as `_o` once in the constructor.
 *   - For each numeric field: getter/setter with constants baked into the source string.
 *   - For each nested struct field:
 *       - Constructor allocates ONE sub-handle at `this._o + <nestedOffset>` and
 *         stores it as `this._sub_<fieldName>`.
 *       - A getter returns the stored sub-handle reference — no `new` inside the getter.
 *   - Exposes `_rebase(view, baseOffset)` that updates `_v`/`_o` and recursively
 *     rebases each sub-handle. Used by containers and rebase tests.
 *   - All DataView calls use little-endian (`true`) as the last argument.
 *   - Zero allocations on field get/set — sub-handles are pre-constructed and reused.
 *
 * @param fields   The struct field map (field name → NumericType or StructDef).
 * @param offsets  A map of field name → byte offset within the struct.
 */
export function generateHandleClass(
  fields: StructFields,
  offsets: ReadonlyMap<string, { offset: number; type: unknown }>,
): HandleConstructor {
  // Collect nested field descriptors so we can pass child constructors via closure.
  // `new Function()` cannot reference outer variables directly — we pass them as
  // named parameters to the outer factory function.
  const nestedFields: NestedFieldDesc[] = []

  for (const [name, fieldType] of Object.entries(fields)) {
    if (!isNumericType(fieldType)) {
      const entry = offsets.get(name)
      if (entry === undefined) {
        throw new Error(`generateHandleClass: no offset found for nested field "${name}"`)
      }
      // fieldType is a StructDef — retrieve its internal handle constructor.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing internal _Handle on StructDef
      const childDef = fieldType as any
      if (!childDef._Handle) {
        throw new Error(
          `generateHandleClass: nested StructDef for field "${name}" has no _Handle — was it created by struct()?`,
        )
      }
      nestedFields.push({ name, offset: entry.offset, ChildHandle: childDef._Handle })
    }
  }

  // Build parameter names for nested child constructors so they can be captured
  // from the closure via new Function() parameter passing.
  // E.g., for nestedFields [{name:'pos',...},{name:'vel',...}] →
  //   paramNames = ['_C_pos', '_C_vel']
  const paramNames = nestedFields.map(f => `_C_${f.name}`)

  // --- Constructor body ---
  // Sets _v (DataView), _o (base offset), and _slot (internal slot index).
  // _slot is a raw instance property — not exposed via a getter.
  // Tests may access it via (h as any)._slot.
  // Sub-handles receive slot=0 because only the top-level handle returned
  // to the user carries meaningful slot semantics.
  let ctorBody = `this._v=v;this._o=o;this._slot=s;\n`
  for (const { name, offset } of nestedFields) {
    // `new _C_<name>(v, o + <offset>, 0)` — allocation happens ONCE in the constructor.
    // Pass 0 for the sub-handle slot argument to keep the constructor signature uniform.
    ctorBody += `this._sub_${name}=new _C_${name}(v,o+${offset},0);\n`
  }

  // --- _rebase method ---
  // Updates _v, _o, and _slot, then rebases each sub-handle recursively.
  // Sub-handles are rebased with slot=0 (only top-level slot is meaningful).
  let rebaseBody = `this._v=v;this._o=o;this._slot=s;\n`
  for (const { name, offset } of nestedFields) {
    rebaseBody += `this._sub_${name}._rebase(v,o+${offset},0);\n`
  }
  rebaseBody += `return this;\n`

  // --- Public slot getter ---
  // Exposes this._slot as a read-only getter. No setter is emitted — assignment is a no-op at runtime
  // and a type error at compile time (readonly slot: number on Handle<F>).
  const slotGetterBody = `get slot(){return this._slot}\n`

  // --- Field accessors ---
  let accessorBody = ''
  for (const [name, fieldType] of Object.entries(fields)) {
    const entry = offsets.get(name)
    if (entry === undefined) {
      throw new Error(`generateHandleClass: no offset found for field "${name}"`)
    }
    const { offset } = entry

    if (isNumericType(fieldType)) {
      const methods = DATAVIEW_METHODS[fieldType]
      // Constants baked in: no runtime lookup on get/set.
      accessorBody += `get ${name}(){return this._v.${methods.get}(this._o+${offset},true)}\n`
      accessorBody += `set ${name}(v){this._v.${methods.set}(this._o+${offset},v,true)}\n`
    } else {
      // Nested struct: return pre-constructed sub-handle reference — zero allocation.
      accessorBody += `get ${name}(){return this._sub_${name}}\n`
    }
  }

  // The outer factory function receives child constructors as named arguments,
  // making them available in the generated Handle class closure.
  const factoryParams = paramNames.length > 0 ? paramNames.join(',') : ''
  const factoryBody = [
    `return class Handle{`,
    `constructor(v,o,s){${ctorBody}}`,
    `_rebase(v,o,s){${rebaseBody}}`,
    slotGetterBody,
    accessorBody,
    `}`,
  ].join('\n')

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: codegen happens once at struct() call time
  const factory = new Function(factoryParams, factoryBody) as (...args: unknown[]) => HandleConstructor

  // Pass the child handle constructors as arguments so they are captured in the closure.
  const childCtors = nestedFields.map(f => f.ChildHandle)
  return factory(...childCtors)
}
