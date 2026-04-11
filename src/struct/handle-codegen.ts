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
  new (view: DataView, baseOffset: number): object
}

/**
 * Generates a handle class via new Function() for a flat (non-nested) struct.
 *
 * The generated class:
 *   - Stores DataView as `_v` and base offset as `_o` once in the constructor.
 *   - Has a getter/setter per field with constants baked into the source string.
 *   - All DataView calls use little-endian (`true`) as the last argument.
 *   - Zero allocations on field get/set — constants are inlined, not computed.
 *
 * Throws if any field is a nested StructDef — nested support is task-4.
 *
 * @param fields   The struct field map (field name → NumericType or StructDef).
 * @param offsets  A map of field name → byte offset within the struct.
 */
export function generateHandleClass(
  fields: StructFields,
  offsets: ReadonlyMap<string, { offset: number; type: unknown }>,
): HandleConstructor {
  let body = 'return class Handle{\n'
  body += 'constructor(v,o){this._v=v;this._o=o}\n'

  for (const [name, fieldType] of Object.entries(fields)) {
    // Guard: throw for nested structs — support is task-4
    if (!isNumericType(fieldType)) {
      throw new Error(
        `generateHandleClass: nested structs not yet supported in task-3 (field: "${name}")`,
      )
    }

    const entry = offsets.get(name)
    if (entry === undefined) {
      throw new Error(`generateHandleClass: no offset found for field "${name}"`)
    }

    const { offset } = entry
    const methods = DATAVIEW_METHODS[fieldType]

    // Getter: return this._v.getXxx(this._o + <CONST>, true)
    // Setter: this._v.setXxx(this._o + <CONST>, v, true)
    // Constants (offset, method names) are baked into the string — no runtime lookup.
    body += `get ${name}(){return this._v.${methods.get}(this._o+${offset},true)}\n`
    body += `set ${name}(v){this._v.${methods.set}(this._o+${offset},v,true)}\n`
  }

  body += '}'

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: codegen happens once at struct() call time
  return new Function(body)() as HandleConstructor
}
