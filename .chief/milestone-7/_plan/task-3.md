# Task 3: Graduation Logic

**Status:** Not started
**Type:** Implementation
**Estimated effort:** 60-90 minutes
**Depends on:** Task 2

## Objective

Implement the graduation mechanism that transitions a vec from JS mode to SoA mode. This includes auto-graduation during push() when `len >= graduateAt`, immediate graduation on `.column()` call, explicit `.graduate()` method, and `.mode` / `.isGraduated` public properties.

## Scope

**In scope:**
- `_graduateAt` internal threshold (default 128)
- Auto-graduation during `push()`: when `_len >= _graduateAt` and `_mode === 'js'`, trigger graduation before completing the push
- Graduation process:
  1. Allocate TypedArray columns via `computeColumnLayout` + `buildColumns`
  2. Copy all data from `_items` JS objects into TypedArray columns
  3. Generate SoA handle class via `generateSoAHandleClass`
  4. Set `_mode = 'soa'`
  5. Set `_items = null` (release JS objects for GC)
  6. Replace `_handle` with SoA handle instance
- `.column(name)` in JS mode: triggers graduation first, then returns TypedArray
- `.graduate()` method: triggers graduation regardless of len; no-op if already SoA
- `.mode` property: returns `'js' | 'soa'`
- `.isGraduated` property: returns boolean (true if mode is 'soa')
- One-way graduation: once graduated, never degrades back even if items are removed
- Update `Vec<F>` interface type to include `mode`, `isGraduated`, `graduate()`
- Unit tests for graduation correctness

**Out of scope:**
- Options API (Task 4) -- for now, graduation threshold is hardcoded at 128
- `shrinkToFit()` -- deferred to M8
- Handle invalidation warnings -- document only, no runtime guard

## Rules & Contracts

- `.chief/_rules/_verification/verification.md`
- `.chief/milestone-7/_goal/hybrid-vec-design-spec.md` -- Sections 4 (Graduation Process) and 5 (Threshold)
- Public API additions must have tests
- `buffer` property: must work after graduation (returns the SoA ArrayBuffer)

## Steps

### 3a: Graduation Function

Inside `vec.ts`, implement a `graduate()` internal function:

```
function graduateToSoA():
  1. layout = def._columnLayout ?? computeColumnLayout(def.fields)
  2. Compute initial SoA capacity: max(_len * 2, DEFAULT_CAPACITY) -- give room to grow
  3. Allocate ArrayBuffer(layout.sizeofPerSlot * soaCapacity)
  4. buildColumns(newBuf, soaCapacity)  -- reuse existing buildColumns
  5. Copy data from _items into columns:
     for each column in layout.columns:
       for i in 0.._len:
         column.array[i] = getNestedValue(_items[i], column.name)
     where getNestedValue resolves dotted paths like 'pos.x'
  6. HandleClass = generateSoAHandleClass(layout.handleTree, columnRefs)
  7. _handle = new HandleClass(0)
  8. _mode = 'soa'
  9. _items = null
  10. _buf = newBuf
  11. _capacity = soaCapacity
```

The dotted-path value extraction (`getNestedValue`) should also be codegen'd for performance -- generate a function like:
```javascript
function copyToColumns(items, len, col_pos_x, col_pos_y, ...) {
  for (let i = 0; i < len; i++) {
    const o = items[i];
    col_pos_x[i] = o.pos.x;
    col_pos_y[i] = o.pos.y;
    // ...
  }
}
```

### 3b: Auto-Graduation in push()

In the JS mode branch of `push()`:
```
if (_mode === 'js') {
  // ... existing JS push logic ...
  _len++
  if (_len >= _graduateAt) {
    graduateToSoA()
    // Rebase the SoA handle to the slot just pushed
    _handle._rebase(_len - 1)
  }
  return _handle
}
```

Important: the push itself completes in JS mode (the item is added to `_items`), then graduation copies everything including the just-pushed item to SoA. After graduation, `_handle` is the SoA handle.

### 3c: .column() Triggers Graduation

```
column(name) {
  assertLive()
  if (_mode === 'js') {
    graduateToSoA()
  }
  // Now in SoA mode, return the TypedArray
  return _columnMap.get(name)
}
```

### 3d: Public Properties

Add to the returned vec object:
- `get mode(): 'js' | 'soa' { return _mode }`
- `get isGraduated(): boolean { return _mode === 'soa' }`
- `graduate(): void { if (_mode === 'js') graduateToSoA() }`

### 3e: Update Vec Interface

Add to the `Vec<F>` interface in `vec.ts`:
- `readonly mode: 'js' | 'soa'`
- `readonly isGraduated: boolean`
- `graduate(): void`

### 3f: Tests

Create `tests/vec/vec-graduation.test.ts`:
- Push items below threshold, verify mode is 'js'
- Push to threshold, verify mode switches to 'soa'
- After graduation, all data is accessible and correct via SoA handles
- After graduation, push/get/forEach/swapRemove/remove all work (SoA path)
- `.column()` in JS mode triggers graduation and returns valid TypedArray
- `.graduate()` forces graduation at any len
- `.graduate()` is no-op when already SoA
- `.isGraduated` reflects mode correctly
- `.mode` returns correct string
- Pop below threshold after graduation does NOT degrade back to JS
- `buffer` works after graduation
- Data integrity: push N items in JS mode, graduate, verify all N items have correct values

## Acceptance Criteria

- [ ] `bun test` passes with zero failures
- [ ] `bun run typecheck` passes with zero errors
- [ ] Auto-graduation triggers at len >= 128 during push
- [ ] .column() triggers graduation from JS mode
- [ ] .graduate() forces graduation at any len
- [ ] One-way: graduation never reverses
- [ ] Data integrity maintained across graduation (all field values preserved)
- [ ] .mode and .isGraduated report correct state
- [ ] Vec interface type updated with new members
- [ ] All graduation tests pass

## Verification

```bash
bun test
bun run typecheck
```

## Deliverables

- Modified `src/vec/vec.ts` -- graduation logic, public properties
- Modified `src/vec/js-codegen.ts` -- add copy-to-columns codegen if needed
- `tests/vec/vec-graduation.test.ts`
- Updated `Vec<F>` interface
