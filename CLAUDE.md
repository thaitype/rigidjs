# CLAUDE.md

## Overview

This project uses a structured **Chief Agent Framework** to enable goal-driven autonomous development with minimal human intervention.

The system is designed so that:

* Humans define **direction, rules, and constraints**
* The **chief-agent** plans and orchestrates work
* Builder and tester agents execute and verify tasks
* The system progresses milestone by milestone with clear contracts and verification

The primary objective is to reduce human involvement in execution while maintaining correctness, safety, and alignment with project goals.

---

# `.chief` Directory Structure

The `.chief` directory contains all structured planning, rules, goals, and execution state.

```
.chief
├── _rules
│   ├── _contract
│   ├── _goal
│   ├── _verification
│   └── _standard
├── _template
└── milestone-1
    ├── _contract
    ├── _goal
    ├── _plan
    └── _report
```

Multiple milestones may exist.

A milestone can be:

* a simple numeric milestone (milestone-1, milestone-2)
* or a real ticket reference (e.g. `milestone-PROJ-1234`)

---

# Rules Hierarchy Priority

Rules must always be resolved using the following priority:

1. **CLAUDE.md** (highest authority)
2. `.chief/_rules`
3. `.chief/milestone-X/_goal` (lowest authority)

Example:
If CLAUDE.md states:

> "Do not use MongoDB ObjectId in service layer"

But `.chief/_rules` states:

> "MongoDB ObjectId may be used in some cases"

Then **CLAUDE.md always overrides**.

---

# Human vs AI Responsibilities

## Human Responsibilities

Humans focus primarily on:

* Writing and refining `CLAUDE.md`
* Maintaining `_rules`
* Defining goals clearly

Humans should not micromanage implementation details.

Clear rules and goals allow agents to work autonomously and safely.

## AI Responsibilities

AI agents must:

* Follow CLAUDE.md strictly
* Follow `.chief/_rules`
* Follow milestone goals and contracts
* Execute tasks safely and correctly
* Ask for clarification only when multiple valid paths exist

---

# `.chief/_rules` Directory

This directory defines global rules that apply to all milestones.

It contains four subfolders:

### `_standard`

General rules shared across all milestones:

* coding standards
* security policies
* database access rules
* architectural constraints

### `_goal`

General high-level goals shared across milestones.

### `_contract`

Shared system contracts:

* data models
* API contracts
* schema definitions
* system conventions

### `_verification`

Defines how work must be verified:

* test commands
* build requirements
* lint/type requirements
* definition of done

### Writing style rules for all rule files

All markdown inside `_rules` must be:

* concise
* structural
* clear
* not overly verbose
* include small code examples when useful
* eliminate ambiguity

Anything unclear may lead to incorrect autonomous decisions.

---

# `.chief/milestone-X` Directory

Each milestone has its own directory.

```
milestone-X
├── _contract
├── _goal
├── _plan
└── _report
```

## `_contract`

Milestone-specific contracts.
May be more detailed than global contracts, but must never conflict with them.

Examples:

* API schema for this milestone
* DB schema
* service boundaries

## `_goal`

Milestone-specific goals.
More detailed than global goals but must not conflict.

## `_plan`

Execution plan and task list for this milestone.

## `_report`

Reference material produced during the milestone. Examples: bug investigation reports, diagnostic reports, review results, performance analyses, task output folders. Not plans, contracts, or goals -- just reference documents.

---

# `.chief/milestone-X/_plan` Directory

Contains planning and execution tracking.

### Files

* `_todo.md` → main checklist for milestone
* `task-1.md`, `task-2.md`, etc → detailed task specs

### `_todo.md` Example

```md
# TODO List for Milestone X

- [ ] task-1: implement authentication module
- [ ] task-2: set up database schema
- [ ] task-3: write unit tests for user service
```

Chief-agent must update `_todo.md` by marking completed tasks:

```
[x]
```

Tasks should be kept small and clear.

## Task Output

Each task can have file output when needed, the output should be placed at `.chief/milestone-X/_report/task-Y/`

---

# CLAUDE.md Purpose

CLAUDE.md is the highest authority file.

It should NOT contain excessive detail.

It should contain:

* system overview
* architecture overview
* important rules
* tech stack
* directory structure
* how to run/test

Detailed rules belong in `.chief/_rules`.

---

# 3-Agent Architecture

## 1. Chief-Agent (Planner / Orchestrator)

The decision-making brain.

Responsibilities:

- Read `CLAUDE.md`
- Read global rules under `.chief/_rules`
- Analyze milestone goals and contracts
- Create and maintain `_plan`
- Break work into small tasks (3–5 at a time)
- Delegate implementation to builder-agent
- Delegate long-running validation to tester-agent
- Update `_todo.md`
- Decide next steps

Chief-agent resolves ambiguity, ensures rule compliance, and minimizes unnecessary human intervention.

---

## 2. Builder-Agent (Implementer)

The fast execution engine.

Responsibilities:

- Implement tasks defined in `.chief/<milestone>/_plan/task-X.md`
- Follow `.chief/_rules/_standard`
- Fix type/lint/test fallout autonomously
- Run short deterministic verification commands
- Commit code after verification passes

Builder-agent handles:

- Unit tests
- Type checks
- Lint
- Local deterministic build verification

Builder-agent does NOT:

- Perform external acceptance testing
- Validate real environments
- Make architecture decisions
- Modify contracts unless explicitly allowed

---

## 3. Tester-Agent (Long-Running Verifier)

The integration and stability validator.

Responsibilities:

- Execute long-running or non-deterministic tests
- Validate UI flows
- Validate API integrations
- Validate authentication flows (e.g. Entra)
- Perform integration and end-to-end testing
- Validate environment-level behavior

Tester-agent does NOT:

- Implement code
- Patch bugs
- Refactor systems

Tester-agent reports findings back to chief-agent for decision.

---

# Responsibility Separation

| Responsibility Type        | Builder-Agent | Tester-Agent |
|----------------------------|---------------|--------------|
| Unit tests                 | ✅            | ❌           |
| Type/lint/build checks     | ✅            | ❌           |
| Integration testing        | ❌            | ✅           |
| UI testing                 | ❌            | ✅           |
| External auth validation   | ❌            | ✅           |
| Cloud/environment checks   | ❌            | ✅           |
| Code fixes                 | ✅            | ❌           |
| Architecture decisions     | ❌            | ❌ (Chief)   |

This separation prevents slow loops and keeps execution stable.

---

# Core Design Philosophy

This system is designed so that:

Human defines direction →
Chief-agent plans →
Builder builds →
Tester verifies →
Chief decides →
Repeat

Minimal human intervention.
Maximum clarity and safety.

## Development Commands

```bash
bun install        # install dependencies
bun test           # run unit tests (bun:test)
bun run typecheck  # tsc --noEmit (strict)
```

Definition of done for any task: `bun test` passes AND `bun run typecheck` passes. See `.chief/_rules/_verification/` for details.

## Architecture Overview

RigidJS provides Rust-inspired memory primitives for JavaScript: `struct`, `slab`, `vec`, `bump`, `.iter()`, `.drop()`. Data lives in contiguous `ArrayBuffer` memory instead of JS objects, eliminating GC pressure and hidden-class deopts in hot paths.

The authoritative product specification is `.chief/_rules/_goal/rigidjs-design-spec-v3.md`. Read it before making API or layout decisions.

### Tech Stack

- **Runtime:** Bun (JavaScriptCore)
- **Language:** TypeScript 5, strict mode, ESM only (`"type": "module"`)
- **Test runner:** `bun:test`
- **Memory primitives:** `ArrayBuffer`, `DataView`, typed arrays
- **Bun APIs (as needed):** `bun:jsc` (heap stats), `Bun.nanoseconds()` (benchmarks)
- **No runtime dependencies.** Dev-only: `@types/bun`, `typescript`.

### Key Architectural Patterns

1. **Blueprint vs allocation separation.** `struct()` is only a type definition — it allocates no memory. Containers (`slab`, `vec`, `bump`) own the `ArrayBuffer`.
2. **Code-generated handles.** Per-struct accessor classes are generated at `struct()` call time using `new Function()` (Elysia Sucrose style). No `Proxy`, no per-access closure — JIT-inlineable DataView reads/writes at computed offsets.
3. **DataView for mixed types.** All field reads/writes go through a single `DataView` over the container's `ArrayBuffer`. Unaligned access is allowed — no padding between fields.
4. **Declaration-order layout.** Fields are laid out in the exact order declared. No reordering, no padding. `sizeof` is the sum of field sizes.
5. **Nested structs inline.** A struct field embedded in another struct occupies `sizeof(inner)` bytes at the parent's offset — not a pointer.
6. **Deterministic `.drop()`.** Containers release their buffer explicitly. Use after drop throws.

### Directory Structure

```
rigidjs/
├── CLAUDE.md                 # highest-authority rules (this file)
├── .chief/                   # Chief Agent Framework state
│   ├── _rules/               # global rules (_standard, _goal, _contract, _verification)
│   └── milestone-N/          # per-milestone goal, contract, plan, report
├── src/                      # library source
│   └── index.ts              # public entry — re-exports public API only
├── tests/                    # bun:test unit tests mirroring src/
├── examples/                 # runnable usage examples
├── package.json
└── tsconfig.json
```

Subdirectories under `src/` are added per milestone (e.g., `src/struct/`). Do not introduce top-level source directories outside `src/`.

### Important Development Rules

1. **No hidden allocations in hot paths.** Handle accessors, container methods (`insert`, `push`, `alloc`, `get`), and iterators must not allocate JS objects per call. Allocate once at container creation and reuse.
2. **No `Proxy` for handles.** Use `new Function()` code generation. Proxies defeat JIT inlining.
3. **Strict TypeScript.** No `any` in public API. Use generics to propagate struct field types to handle accessors so `slab(Vec3).insert().x` is typed as `number`.
4. **ESM only.** No CommonJS. No default exports for library API — named exports only.
5. **Public API is append-only within a milestone.** Never rename or remove a symbol listed in `.chief/_rules/_contract/` or `.chief/milestone-N/_contract/` without chief-agent approval.
6. **Tests co-locate by feature.** Place tests in `tests/<feature>.test.ts`. Every public API symbol must have at least one correctness test.
7. **No runtime dependencies.** RigidJS stays dependency-free. Anything outside `bun:*` and JS built-ins requires chief-agent approval.
8. **Do not edit `.chief/_rules/_goal/rigidjs-design-spec-v3.md`.** It is the product north star. Propose changes via chief-agent if a gap is found.
