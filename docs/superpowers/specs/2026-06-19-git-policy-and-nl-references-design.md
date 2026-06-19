# Design: git policy (safe-by-default, cascading) + natural-language references

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan

## Context

Two ergonomics/safety gaps surfaced while reading real `.loop` files:

1. **Brittle file references.** `look at: billing/form.tsx, api/settings.ts, …` makes the author memorize exact paths. Humans don't.
2. **No git strategy.** The #1 fear with agents is "will it commit? push? where?" Today git is only `ask me before pushes` (a confirm gate) — no branch, no worktree, no commit cadence, and nothing stops a push to `main`. And the author shouldn't have to restate git in every loop.

Both are about making agent-driven work **safe and ergonomic by default**.

## Feature A — natural-language references (light)

`look at:` already stores its items as free-text strings and hands them to the plan step as "relevant files". So natural-language descriptions already pass through; the agent (which has Read/Grep/Glob during plan) can resolve them. We formalize this — **no grammar change**:

- `look at: the billing form, the settings API, and the last failure` is valid: each item is *a file path OR a description of one*; the agent locates the real files before acting.
- Change the plan prompt builder (`packages/runtime/src/runners/claudeCode.ts` `buildPlanPrompt`) so context items are framed as "files or descriptions — find the actual files first."
- Update the native runner (`.claude/skills/loop/SKILL.md`), `AGENTS.md`, `docs/MANUAL.md`, and the tutorial examples to show prose `look at:`.
- `flow` / `for each` file refs stay path-based (authored once, not the daily pain).

## Feature B — declarative `git:` policy, safe-by-default, cascading

### Surface

A `git:` block, in the config tier (file-level) and optionally per loop:

```loop
git:
  work on a branch          # isolation: in place (default) | on a branch ["name"] | in a worktree ["name"]
  commit when the goal is met   # cadence: when the goal is met | each cycle | each story | never
  push when done                # opt-in; omit = no push
  open a pull request           # opt-in; implies push
```

Natural-language line forms the parser accepts:
- Isolation: `work in place` · `work on a branch` · `work on a branch "<name>"` · `work in a worktree` · `work in a worktree "<name>"`
- Commit cadence: `commit when the goal is met` (alias `commit when done`) · `commit each cycle` · `commit each story` · `commit never` (alias `do not commit`)
- Push: `push when done` (alias `push`) · `do not push`
- PR: `open a pull request` (alias `open a pr`)

### The cascade (the author rarely writes git)

The effective policy for a unit is the **merge of three levels**, lowest-priority first:

1. **Built-in default** (used when nothing is declared anywhere):
   `work on a branch` + `commit when the goal is met`, **no push**.
   So even with zero git config, every run isolates on an auto-named branch and commits its result — saved for review, nothing leaves the machine.
2. **File-level `git:`** (config tier) — set once at the top; every definition in the file inherits it.
3. **Per-loop `git:`** — optional; *adds to / overrides* the inherited policy.

**Merge rule:** a level overrides a field it sets; unset fields inherit. Booleans (`push`, `openPr`) and cadence/isolation: the more specific level wins; `commit never` / `do not push` / `work in place` are how a level *dials down* an inherited value. **Isolation is resolved at the run level** (one branch/worktree per run) from built-in ⊕ entry-file; per-loop blocks adjust **commit cadence / push / PR**, not isolation.

Cross-file/base sharing rides the existing `use the <method>` preset (a method may carry a `git:` block). No new `inherits` keyword.

### Safety (always enforced, not optional)

- **Never push to `main` or `master`** (the protected set). `GitIO.push` refuses a protected branch.
- Push only ever targets a non-protected branch. If the resolved isolation is `in place` on a protected branch **and** push is requested, the run **errors up front**: "refusing to push to `main` — add `work on a branch`."
- No `git:` anywhere ⇒ the built-in default applies (branch + commit, no push). To fully opt out: `git: work in place` + `commit never`.
- The existing `ask me before pushes` action policy continues to work independently of this block.

## Architecture

### IR + parser (`@loop/parser`)
- `GitPolicy { isolation?: "in-place"|"branch"|"worktree"; branch?: string; commit?: "done"|"cycle"|"story"|"never"; push?: boolean; openPr?: boolean }`.
- `Config.git?: GitPolicy` (file-level) and `Loop.git?: GitPolicy` (per-loop, cadence/push/pr only).
- Parser: recognize a `git:` block (header at the relevant indent, indented child lines) in the config tier and inside a loop body; parse the line forms above. Mirror to `spec/loop-spec.schema.json`.
- No `look at:` grammar change.

### Runtime (`@loop/runtime`)
- New injected **`GitIO`** (DI, like `Runner`/`Verifier`/`HumanIO`):
  - `start({isolation, branch?, name, baseDir}): Promise<{dir, branch}>` — create the branch/worktree (or no-op for in-place); return the working dir + active branch.
  - `commit({message, dir}): Promise<void>`
  - `push({branch, dir}): Promise<void>` — **throws on a protected branch**.
  - `openPr({title, branch, dir}): Promise<string|null>`
  - `protectedBranches` (default `["main","master"]`).
- A pure helper `resolveGit(...levels): GitPolicy` implementing the cascade/merge (unit-tested).
- `RunOptions.git?: GitIO`.
- Engine hooks:
  - `run()` resolves the run policy (built-in ⊕ file), calls `git.start` when isolation ≠ in-place, switches the run's `baseDir` to the returned dir (so the agent operates in the worktree), enforces the protected-branch rule, runs the definitions, then on success commits (`done`), pushes, and opens a PR per policy.
  - `executeLoop` commits after each cycle when the effective policy is `each cycle`; commits on satisfied finish when `when the goal is met`.
  - `executePipeline` / `executeFlow` commit after each satisfied stage/step when `each story`.
  - Per-loop `git:` is merged onto the run policy for cadence/push/pr at the loop boundary.
- New `git` `LoopEvent`s: `{type:"git", action:"branch"|"worktree"|"commit"|"push"|"pr", detail}`.
- **Backward-compat guard:** all git hooks are active **only when `RunOptions.git` is provided**. With no `GitIO` (the default for existing callers and the current test suite), the engine does no git at all — the built-in default takes effect only once a `GitIO` is present (the CLI provides the real one; engine tests opt in with a mock). This keeps every existing test and embedding unchanged.

### CLI (`@loop/runtime/src/cli.ts`)
- Wire the real `GitIO` (shells `git` for branch/worktree/commit/push, `gh` for PRs). Render the `git-*` events in the trace.

### Native runner (`.claude/skills/loop/SKILL.md`)
- Document the cascade, the built-in default, and the safety rule. The in-chat executor performs the git ops itself (via Bash) at the policy's points and **must never push to `main`/`master`**.

### Surfaces
- `README.md`, `AGENTS.md`, `docs/MANUAL.md`: document `git:`, the cascade, the default, and safety.
- An example showing a `git:` block; update the tutorial (a "Git strategy" section + the NL-references note).

## Scope / decomposition

One cohesive branch, built subagent-driven (like `flow`/`for each`) with adversarial verification:
1. Feature A (prompt + docs) — small.
2. `GitPolicy` IR + parser + schema (file-level + per-loop) + `resolveGit` cascade helper.
3. `GitIO` interface + a real shell impl + a mock; engine setup/commit/push/PR hooks + safety enforcement + events.
4. CLI wiring + git event trace.
5. SKILL.md + docs + example + tutorial.

## Verification

- Parser tests: every `git:` line form → `GitPolicy`; file-level and per-loop; round-trips through the schema.
- `resolveGit` unit tests: built-in → file → per-loop merge; dial-down (`work in place`, `commit never`); push opt-in.
- Engine tests (mock `GitIO` + mock runner): default applies a branch + commit-on-done; `each cycle`/`each story` cadence fires at the right points; `push when done` calls `GitIO.push`; **a protected-branch push throws / the in-place-on-main + push case errors up front**; events emitted in order; no-git still works (mock).
- `loop parse` on the example shows the `GitPolicy` IR; full `npm run build && npm test` green.
- Manual: a real `loop run` with `git: work on a branch, commit when done` creates the branch and commits, and refuses a `main` push.
- Whole-branch opus review before merge.
