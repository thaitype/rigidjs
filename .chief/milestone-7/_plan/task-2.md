# Task 2: JS Mode Layer

**Status:** Not started
**Type:** Implementation
**Estimated effort:** 60-90 minutes
**Depends on:** Task 1 (must PASS)

## Objective

Implement the JS mode storage layer: a JS object factory codegen from struct schema, a JSHandle class with plain property access, and JS mode implementations of all vec methods (push, pop, get, forEach, for..of, swapRemove, remove, clear, drop, reserve, len, capacity).

## Scope

**In scope:**
- JS object factory codegen: generate a `createObject()` function from the struct schema that creates plain JS objects with all fields initialized in declaration order (stable hidden class)
- JSHandle class codegen: generate a handle class that wraps a JS object reference with getter/setter property access (matching the same `Handle<F>` type as SoA handles)
- JS mode storage: `_items: Array<object>` backing store
- All vec methods in JS mode path (inside the `else` branch from Task 1):
  - `push()`: create JS object via factory, append to `_items`, return JSHandle
  - `pop()`: remove last item from `_items`
  - `get(i)`: return JSHandle wrapping `_items[i]`
  - `forEach(cb)`: loop over `_items`, rebase JSHandle to each
  - `[Symbol.iterator]()`: iterator that rebases JSHandle
  - `swapRemove(i)`: copy last item to index i, pop
  - `remove(i)`: splice `_items`
  - `clear()`: reset `_items` length to 0
  - `drop()`: null out `_items`
  - `reserve(n)`: no-op in JS mode (JS arrays don't need pre-allocation)
  - `len`: return `_items.length`
  - `capacity`: return `_items.length` in JS mode (capacity equals length -- JS arrays grow automatically)
  - `buffer`: throw Error in JS mode ("buffer not available in JS mode")
  - `column()`: defer to Task 3 (throw "not implemented" for now)
- Default behavior: `vec(Particle)` starts in JS mode with `_mode = 'js'`
- **Temporarily break** `vec(Particle, 16)` -- the second arg will be reworked in Task 4
- Unit tests for all JS mode operations

**Out of scope:**
- Graduation logic (Task 3)
- Options API (Task 4)
- SoA mode entry via options (Task 4)
- `.column()` in JS mode (Task 3 -- graduation trigger)
- `.graduate()` (Task 3)
- `.mode` / `.isGraduated` properties (Task 3)

## Rules & Contracts

- `.chief/_rules/_verification/verification.md` -- `bun test` and `bun run typecheck` must pass
- `.chief/_rules/_standard/` -- no new dependencies
- `.chief/milestone-7/_goal/hybrid-vec-design-spec.md` -- Section 4 (Internal Architecture, JS Mode Storage)
- `Handle<F>` type must be satisfied by JSHandle -- same getter/setter interface

## Steps

### 2a: JS Object Factory Codegen

Create `src/vec/js-codegen.ts` (or similar) with:

1. A function `generateJSObjectFactory(fields: StructFields): () => object` that uses `new Function()` to create a factory producing plain JS objects with all fields initialized in declaration order
2. For nested structs: create nested object literals `{ x: 0, y: 0, z: 0 }`
3. All numeric fields initialized to 0
4. Every call to the factory must produce objects with the same hidden class (same property order)

Example output for `struct({ pos: Vec3, life: 'f32', id: 'u32' })`:
```javascript
function create() { return { pos: { x: 0, y: 0, z: 0 }, life: 0, id: 0 } }
```

### 2b: JSHandle Codegen

1. A function `generateJSHandleClass(fields: StructFields): JSHandleConstructor` that uses `new Function()` to create a handle class
2. Constructor takes `(obj)` -- the JS object to wrap
3. `_rebase(obj)` method to point at a different JS object (for handle reuse)
4. Getters/setters: `get life() { return this._obj.life }`, `set life(v) { this._obj.life = v }`
5. Nested fields: `get pos() { return this._sub_pos }` where `_sub_pos` is a sub-handle wrapping `this._obj.pos`
6. Nested sub-handle `_rebase` must update to `this._obj.pos` reference on parent rebase
7. `get slot()` returns the current index in the `_items` array (stored as `this._slot`)

### 2c: Wire JS Mode into vec.ts

1. When `_mode === 'js'`, all methods use `_items` array and JSHandle
2. The shared `_handle` is a JSHandle instance (reused, never allocates per call)
3. `_items` is a plain JS array: `const _items: object[] = []`
4. push: `const obj = _createObject(); _items.push(obj); _jsHandle._rebase(obj); _jsHandle._slot = _len; _len++; return _jsHandle`
5. get: bounds check, then `_jsHandle._rebase(_items[index]); _jsHandle._slot = index; return _jsHandle`
6. forEach: loop `_items`, rebase handle each iteration
7. swapRemove: `_items[i] = _items[last]; _items.pop()`
8. remove: `_items.splice(i, 1)` (or shift manually)

### 2d: Tests

Create `tests/vec/vec-js-mode.test.ts` with tests for:
- push and read back field values
- push multiple items, verify all accessible via get(i)
- pop reduces length
- get out of range throws
- swapRemove correctness (last element moves to removed index)
- remove correctness (order preserved)
- clear resets length
- drop makes all ops throw
- forEach visits all elements in order
- for..of iterator visits all elements
- Handle reuse: same object returned from push/get
- Nested struct field access (pos.x, pos.y, etc.)

## Acceptance Criteria

- [ ] `bun test` passes with zero failures
- [ ] `bun run typecheck` passes with zero errors
- [ ] `vec(Particle)` creates a vec in JS mode
- [ ] push/get/forEach/for..of/swapRemove/remove/pop/clear/drop all work in JS mode
- [ ] JSHandle supports nested struct field access (h.pos.x = 5; h.pos.x === 5)
- [ ] All JS mode tests pass
- [ ] No new runtime dependencies
- [ ] Existing SoA mode tests may break due to `vec(T, capacity)` signature change -- mark those as known and fix in Task 4

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- `src/vec/js-codegen.ts` -- JS object factory and JSHandle codegen
- Modified `src/vec/vec.ts` -- JS mode paths wired in
- `tests/vec/vec-js-mode.test.ts` -- JS mode unit tests
