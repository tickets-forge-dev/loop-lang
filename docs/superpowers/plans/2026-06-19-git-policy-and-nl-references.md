# Git policy + natural-language references — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent-driven git safe-by-default and configurable via a cascading `git:` policy, and let `look at:` use natural-language descriptions instead of exact paths.

**Architecture:** A new `GitPolicy` IR (file-level `Config.git` + per-loop `Loop.git`), parsed from a `git:` block. A pure `resolveGit(...levels)` merges built-in → file → loop. A new injected `GitIO` (DI, like Runner/Verifier) performs branch/worktree/commit/push/PR; the engine calls it only when a `GitIO` is provided, at the outermost `run()` (setup + push/PR + safety) and at cadence boundaries (commit). NL references are a plan-prompt + docs change.

**Tech Stack:** TypeScript 5.5 ESM, Node ≥18, `node --test` against built `dist/`, hand-written parser, JSON-Schema-as-source-of-truth IR.

## Global Constraints

- **Safe by default:** built-in git policy = `work on a branch` + `commit when the goal is met`, **no push**. **Never push to `main` or `master`** (protected set) — `GitIO.push` must refuse them; this is not optional.
- **Backward-compat:** all git hooks fire **only when `RunOptions.git` is set**. With no `GitIO`, the engine does no git (existing callers + the current test suite are unchanged). `LOOP_VERSION` stays `"0.1"`; all new IR fields optional.
- **Cascade merge order:** built-in → file-level (`Config.git`) → per-loop (`Loop.git`). A level overrides fields it sets. Isolation/push/PR are resolved at the **run level** (built-in ⊕ file); per-loop adjusts **commit cadence**.
- Tests run against built `dist/`: edit `src` → `npm run build -w @loop/parser -w @loop/runtime` → `npm test -w @loop/runtime` (build parser before runtime).
- Schema (`spec/loop-spec.schema.json`) and `packages/parser/src/types.ts` stay in sync.
- Follow existing idioms (`childrenOf`/`quoted`/`ParseError`; DI interfaces; `emit`).

## Canonical types (every task uses these verbatim)

```ts
// @loop/parser types.ts
export interface GitPolicy {
  isolation?: "in-place" | "branch" | "worktree";
  branch?: string;                              // explicit branch/worktree name
  commit?: "done" | "cycle" | "story" | "never";
  push?: boolean;
  openPr?: boolean;
}
// Config.git?: GitPolicy ;  Loop.git?: GitPolicy

// @loop/runtime types.ts
export interface GitIO {
  protectedBranches?: string[];                 // default ["main","master"]
  start(i: { isolation: "in-place"|"branch"|"worktree"; branch?: string; name: string; baseDir: string }): Promise<{ dir: string; branch: string }>;
  commit(i: { message: string; dir: string }): Promise<void>;
  push(i: { branch: string; dir: string }): Promise<void>;        // MUST throw on a protected branch
  openPr(i: { title: string; branch: string; dir: string }): Promise<string | null>;
}
export interface ResolvedGit { isolation: "in-place"|"branch"|"worktree"; branch?: string; commit: "done"|"cycle"|"story"|"never"; push: boolean; openPr: boolean }
export function resolveGit(...levels: (GitPolicy | null | undefined)[]): ResolvedGit
// RunOptions additions: git?: GitIO; gitPolicy?: GitPolicy; gitBranch?: string; gitStarted?: boolean
// LoopEvent addition: { type:"git"; action:"branch"|"worktree"|"commit"|"push"|"pr"; detail: string }
```

---

### Task 1: Natural-language references (prompt + docs)

**Files:**
- Modify: `packages/runtime/src/runners/claudeCode.ts` (`buildPlanPrompt`)
- Modify: `packages/runtime/test/runners.test.js`
- Modify: `AGENTS.md`, `docs/MANUAL.md`, `docs/tutorial.html` (the §4 look-at copy)

**Interfaces:** Consumes `PlanInput` (has `files: string[]`). Produces no new API — only changes the plan prompt wording.

- [ ] **Step 1: Failing test** — append to `packages/runtime/test/runners.test.js`:
```js
test("buildPlanPrompt frames context as files-or-descriptions to locate", () => {
  const p = buildPlanPrompt({ goal: "g", files: ["the billing form", "api/x.ts"], includeLastFailure: false, reflection: null, baseDir: "." });
  assert.match(p, /file or a description/i);   // tells the agent to resolve descriptions
  assert.match(p, /the billing form/);
});
```
- [ ] **Step 2: Run → fails** — `npm run build -w @loop/parser -w @loop/runtime && npm test -w @loop/runtime` (the assertion on "file or a description" fails).
- [ ] **Step 3: Implement** — in `buildPlanPrompt`, change the files line from `Relevant files: …` to:
```ts
  if (input.files.length) ctx.push(`Relevant context (each item is a file path or a description of one — locate the actual file(s) first): ${input.files.join(", ")}.`);
```
- [ ] **Step 4: Run → passes** — same command; whole runtime suite green.
- [ ] **Step 5: Docs** — in `AGENTS.md` and `docs/MANUAL.md`, note `look at:` accepts file paths or plain-language descriptions the agent resolves. In `docs/tutorial.html` §4, change the example to `look at: the billing form, the settings API, and the last failure` and add one line that the agent resolves descriptions to files. (Confirm the tutorial's `.loop` highlighter still renders — no new keyword needed.)
- [ ] **Step 6: Commit** — `feat(runtime): look at accepts natural-language descriptions` + the standard trailer lines.

---

### Task 2: `GitPolicy` IR + parser + schema

**Files:**
- Modify: `packages/parser/src/types.ts` (add `GitPolicy`; `Config.git`; `Loop.git`)
- Modify: `spec/loop-spec.schema.json`
- Modify: `packages/parser/src/parser.ts` (a `git:` block at file-level and inside a loop body)
- Modify: `packages/parser/test/parser.test.js`

**Interfaces:** Produces `GitPolicy` (see canonical types), `Config.git?`, `Loop.git?`, and a parsed `git:` block. Consumes nothing new.

- [ ] **Step 1: Failing tests** — append to `packages/parser/test/parser.test.js`:
```js
test("file-level git block parses to config.git", () => {
  const file = parse('git:\n  work on a branch\n  commit when the goal is met\n  push when done\n  open a pull request\nloop "x":\n  goal: g\n  done when "t" passes');
  assert.deepEqual(file.config.git, { isolation: "branch", commit: "done", push: true, openPr: true });
});
test("per-loop git block parses to loop.git", () => {
  const loop = parse('loop "x":\n  goal: g\n  done when "t" passes\n  git:\n    commit each cycle').definitions[0];
  assert.deepEqual(loop.git, { commit: "cycle" });
});
test("git isolation + dial-down forms", () => {
  const a = parse('git:\n  work in a worktree "wt"\n  commit never\n  do not push').config.git;
  assert.deepEqual(a, { isolation: "worktree", branch: "wt", commit: "never", push: false });
  const b = parse('git:\n  work in place').config.git;
  assert.deepEqual(b, { isolation: "in-place" });
});
```
- [ ] **Step 2: Run → fails** — `npm run build -w @loop/parser && npm test -w @loop/parser` (config.git undefined).
- [ ] **Step 3: IR types** — in `packages/parser/src/types.ts` add the `GitPolicy` interface (canonical types), add `git?: GitPolicy;` to `Config` and to `Loop`.
- [ ] **Step 4: Shared line parser** — in `parser.ts` add:
```ts
function parseGitLine(g: GitPolicy, text: string, lineNo: number): void {
  let m: RegExpMatchArray | null;
  if (/^work in place$/i.test(text)) { g.isolation = "in-place"; return; }
  if ((m = text.match(/^work on a branch(?:\s+"([^"]+)")?$/i))) { g.isolation = "branch"; if (m[1]) g.branch = m[1]; return; }
  if ((m = text.match(/^work in a worktree(?:\s+"([^"]+)")?$/i))) { g.isolation = "worktree"; if (m[1]) g.branch = m[1]; return; }
  if (/^commit when (?:the goal is met|done)$/i.test(text)) { g.commit = "done"; return; }
  if (/^commit each cycle$/i.test(text)) { g.commit = "cycle"; return; }
  if (/^commit each story$/i.test(text)) { g.commit = "story"; return; }
  if (/^(?:commit never|do not commit)$/i.test(text)) { g.commit = "never"; return; }
  if (/^(?:push when done|push)$/i.test(text)) { g.push = true; return; }
  if (/^do not push$/i.test(text)) { g.push = false; return; }
  if (/^open a (?:pull request|pr)$/i.test(text)) { g.openPr = true; return; }
  throw new ParseError(`unrecognized git line: "${text}"`, lineNo);
}
function parseGitBlock(lines: Line[], start: number): { git: GitPolicy; next: number } {
  const header = lines[start];
  const { body, next } = childrenOf(lines, start + 1, header.indent);
  if (body.length === 0) throw new ParseError(`empty git block`, header.lineNo);
  const git: GitPolicy = {};
  for (const ln of body) parseGitLine(git, ln.text, ln.lineNo);
  return { git, next };
}
```
- [ ] **Step 5: File-level wiring** — in `parse()` main loop, add a branch BEFORE the `parseConfigLine` fallback:
```ts
    } else if (/^git:?$/i.test(ln.text)) {
      const { git, next } = parseGitBlock(lines, i);
      config.git = git;
      i = next;
    } else if (parseConfigLine(config, ln)) {
```
- [ ] **Step 6: Per-loop wiring** — `interpretLoopBody` currently iterates `for (const ln of body)`. Convert to index-walking so a nested `git:` block can consume its children. Change the loop to:
```ts
  let i = 0;
  while (i < body.length) {
    const ln = body[i];
    const t = ln.text;
    if (/^git:?$/i.test(t)) {
      const { git, next } = parseGitBlock(body, i);
      loop.git = git;
      i = next;
      continue;
    }
    // ... the existing if/else chain on `t`, each arm ending with: i++; continue;  (or fall through)
    // keep every existing branch; replace each `continue;` with `{ i++; continue; }`
    // and the final `throw new ParseError(...)` stays (no i++ needed before a throw)
  }
```
Mechanically: wrap the existing body in `while (i < body.length) { const ln = body[i]; const t = ln.text; … }`, add the `git:` branch first, and ensure every recognized branch advances `i` (turn the trailing `continue;` of each arm into `i++; continue;`). The post-loop `sawGoal`/`sawCycle` checks are unchanged. Import `GitPolicy` where needed.
- [ ] **Step 7: Schema** — in `spec/loop-spec.schema.json` add a `$defs.gitPolicy` (object, additionalProperties:false, optional `isolation` enum [in-place,branch,worktree], `branch` string, `commit` enum [done,cycle,story,never], `push` boolean, `openPr` boolean) and reference it from both `config.properties.git` and `loop.properties.git`.
- [ ] **Step 8: Run → passes** — `npm run build -w @loop/parser && npm test -w @loop/parser`; all parser tests green (existing + 3 new).
- [ ] **Step 9: Commit** — `feat(parser): git policy block (file-level + per-loop)` + trailer.

---

### Task 3: `resolveGit` cascade + `GitIO` interface + mock + RunOptions/events

**Files:**
- Create: `packages/runtime/src/git.ts` (`BUILTIN_GIT`, `resolveGit`, `GitIO`/`ResolvedGit` types, `isProtected`)
- Create: `packages/runtime/src/runners/mockGit.ts` (a recording mock)
- Modify: `packages/runtime/src/types.ts` (RunOptions fields + `git` LoopEvent)
- Modify: `packages/runtime/src/index.ts` (exports)
- Create: `packages/runtime/test/git.test.js`

**Interfaces:** Produces `resolveGit`, `BUILTIN_GIT`, `isProtected`, `GitIO`, `ResolvedGit`, `MockGitIO`; RunOptions gains `git?/gitPolicy?/gitBranch?/gitStarted?`; LoopEvent gains the `git` variant. Consumes `GitPolicy` (Task 2).

- [ ] **Step 1: Failing tests** — `packages/runtime/test/git.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGit, isProtected } from "../dist/index.js";

test("built-in default: branch + commit-done, no push", () => {
  assert.deepEqual(resolveGit(), { isolation: "branch", branch: undefined, commit: "done", push: false, openPr: false });
});
test("file overrides built-in; per-loop overrides file (commit)", () => {
  const r = resolveGit({ isolation: "worktree", push: true }, { commit: "cycle" });
  assert.equal(r.isolation, "worktree"); assert.equal(r.push, true); assert.equal(r.commit, "cycle");
});
test("dial-down: work in place + commit never", () => {
  const r = resolveGit({ isolation: "in-place", commit: "never" });
  assert.equal(r.isolation, "in-place"); assert.equal(r.commit, "never");
});
test("isProtected covers main and master", () => {
  assert.equal(isProtected("main"), true);
  assert.equal(isProtected("master"), true);
  assert.equal(isProtected("loop/fix-x"), false);
});
```
- [ ] **Step 2: Run → fails** (module missing).
- [ ] **Step 3: Implement `git.ts`:**
```ts
import type { GitPolicy } from "@loop/parser";
export interface ResolvedGit { isolation: "in-place"|"branch"|"worktree"; branch?: string; commit: "done"|"cycle"|"story"|"never"; push: boolean; openPr: boolean }
export const BUILTIN_GIT: ResolvedGit = { isolation: "branch", commit: "done", push: false, openPr: false };
export function resolveGit(...levels: (GitPolicy | null | undefined)[]): ResolvedGit {
  const r: ResolvedGit = { ...BUILTIN_GIT };
  for (const lvl of levels) {
    if (!lvl) continue;
    if (lvl.isolation !== undefined) r.isolation = lvl.isolation;
    if (lvl.branch !== undefined) r.branch = lvl.branch;
    if (lvl.commit !== undefined) r.commit = lvl.commit;
    if (lvl.push !== undefined) r.push = lvl.push;
    if (lvl.openPr !== undefined) r.openPr = lvl.openPr;
  }
  return r;
}
const PROTECTED = ["main", "master"];
export function isProtected(branch: string, set: string[] = PROTECTED): boolean {
  return set.includes(branch.trim().toLowerCase());
}
export interface GitIO {
  protectedBranches?: string[];
  start(i: { isolation: "in-place"|"branch"|"worktree"; branch?: string; name: string; baseDir: string }): Promise<{ dir: string; branch: string }>;
  commit(i: { message: string; dir: string }): Promise<void>;
  push(i: { branch: string; dir: string }): Promise<void>;
  openPr(i: { title: string; branch: string; dir: string }): Promise<string | null>;
}
```
Note `resolveGit()` with no args returns the built-in (with `branch: undefined`) — the first test asserts that shape.
- [ ] **Step 4: Mock** — `packages/runtime/src/runners/mockGit.ts`:
```ts
import { isProtected, type GitIO } from "../git.js";
export class MockGitIO implements GitIO {
  public calls: string[] = [];
  constructor(private branchName = "loop/test") {}
  async start(i: any) { this.calls.push(`start:${i.isolation}`); return { dir: i.baseDir, branch: i.branch ?? this.branchName }; }
  async commit(i: any) { this.calls.push(`commit:${i.message}`); }
  async push(i: any) { if (isProtected(i.branch)) throw new Error(`refusing to push to protected branch "${i.branch}"`); this.calls.push(`push:${i.branch}`); }
  async openPr(i: any) { this.calls.push(`pr:${i.branch}`); return "https://example/pr/1"; }
}
```
- [ ] **Step 5: types.ts** — add to `RunOptions`: `git?: import("./git.js").GitIO; gitPolicy?: import("@loop/parser").GitPolicy; gitBranch?: string; gitStarted?: boolean;`. Add to `LoopEvent`: `| { type: "git"; action: "branch"|"worktree"|"commit"|"push"|"pr"; detail: string }`.
- [ ] **Step 6: index.ts exports** — `export { resolveGit, isProtected, BUILTIN_GIT } from "./git.js"; export type { GitIO, ResolvedGit } from "./git.js"; export { MockGitIO } from "./runners/mockGit.js";`
- [ ] **Step 7: Run → passes** — build parser+runtime, `npm test -w @loop/runtime`.
- [ ] **Step 8: Commit** — `feat(runtime): git cascade resolver + GitIO interface + mock` + trailer.

---

### Task 4: Engine git hooks (setup, cadence, push/PR, safety)

**Files:**
- Modify: `packages/runtime/src/engine.ts`
- Modify: `packages/runtime/test/engine.test.js`

**Interfaces:** Consumes `resolveGit`/`isProtected`/`GitIO` (Task 3), `Config.git`/`Loop.git` (Task 2). Produces git behavior in `run`/`executeLoop`/`executePipeline`/`executeFlow`.

- [ ] **Step 1: Failing tests** — append to `packages/runtime/test/engine.test.js` (import `MockGitIO`):
```js
test("git: default applies a branch + commit on done", async () => {
  const file = parse('loop "x":\n  goal: g\n  done when "t" passes\n  each cycle: plan, then act, then observe');
  const git = new MockGitIO("loop/x");
  await run(file, { runner: new MockRunner(), verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p", git });
  assert.ok(git.calls.includes("start:branch"), "started a branch");
  assert.ok(git.calls.some((c) => c.startsWith("commit:")), "committed on done");
  assert.ok(!git.calls.some((c) => c.startsWith("push:")), "no push by default");
});
test("git: push when done pushes to the safe branch", async () => {
  const file = parse('git:\n  work on a branch\n  push when done\nloop "x":\n  goal: g\n  done when "t" passes\n  each cycle: act, then observe');
  const git = new MockGitIO("loop/x");
  await run(file, { runner: new MockRunner(), verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p", git });
  assert.ok(git.calls.some((c) => c === "push:loop/x"));
});
test("git: refuses to push to main (in place)", async () => {
  const file = parse('git:\n  work in place\n  push when done\nloop "x":\n  goal: g\n  done when "t" passes\n  each cycle: act, then observe');
  const git = new MockGitIO("main"); // start returns the current branch "main" for in-place
  await assert.rejects(
    () => run(file, { runner: new MockRunner(), verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p", git }),
    /refusing to push to "main"/
  );
});
test("git: no GitIO → engine does no git (backward compat)", async () => {
  const def = parse('loop "x":\n  goal: g\n  done when "t" passes\n  each cycle: act, then observe').definitions[0];
  const outcome = await runDefinition(def, { runner: new MockRunner(), verifier: new SeqVerifier([true]), human: new ScriptedHumanIO(), baseDir: "/p" });
  assert.equal(outcome.satisfied, true); // unchanged, nothing thrown
});
test("git: commit each cycle commits per cycle", async () => {
  const file = parse('git:\n  work on a branch\n  commit each cycle\nloop "x":\n  goal: g\n  done when "t" passes\n  each cycle: act, then observe\n  after 2 tries: stop and warn "stop"');
  const git = new MockGitIO("loop/x");
  await run(file, { runner: new MockRunner(), verifier: new SeqVerifier([false]), human: new ScriptedHumanIO(), baseDir: "/p", git });
  assert.ok(git.calls.filter((c) => c.startsWith("commit:")).length >= 2, "committed each cycle");
});
```
For the in-place-main test the mock's `start` for `in-place` must return the current branch; have `MockGitIO("main")` and in `start` for `isolation==="in-place"` return `{dir:baseDir, branch:this.branchName}`. Adjust the Task-3 mock so in-place returns `this.branchName` (it already returns `i.branch ?? this.branchName`; for in-place `i.branch` is undefined so it returns `this.branchName` = "main"). Good.
- [ ] **Step 2: Run → fails** (git ignored).
- [ ] **Step 3: Implement** — in `engine.ts`:
  - Import: `import { resolveGit, isProtected } from "./git.js";` and `GitPolicy` from `@loop/parser`.
  - Add a slug helper:
```ts
const slug = (s: string | null | undefined) => (s ?? "loop").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "loop";
async function gitCommit(opts: RunOptions, message: string): Promise<void> {
  if (!opts.git) return;
  await opts.git.commit({ message, dir: opts.baseDir });
  emit(opts, { type: "git", action: "commit", detail: message });
}
```
  - Rewrite `run()` so the OUTERMOST call (no `flowStack`, not already `gitStarted`) sets up git:
```ts
export async function run(file: LoopFile, opts: RunOptions): Promise<LoopOutcome[]> {
  const outer = !opts.flowStack && !opts.gitStarted && !!opts.git;
  if (outer) {
    const policy = resolveGit(opts.gitPolicy, file.config?.git);
    let o: RunOptions = { ...opts, gitPolicy: file.config?.git ?? opts.gitPolicy, gitStarted: true };
    let branch = "";
    if (policy.isolation !== "in-place") {
      const name = `loop/${slug(file.definitions[0] && ("name" in file.definitions[0] ? (file.definitions[0] as any).name : null))}`;
      const ctx = await opts.git!.start({ isolation: policy.isolation, branch: policy.branch, name, baseDir: opts.baseDir });
      branch = ctx.branch;
      o = { ...o, baseDir: ctx.dir, gitBranch: branch };
      emit(o, { type: "git", action: policy.isolation === "worktree" ? "worktree" : "branch", detail: branch });
    } else {
      const ctx = await opts.git!.start({ isolation: "in-place", branch: policy.branch, name: "loop", baseDir: opts.baseDir });
      branch = ctx.branch; o = { ...o, baseDir: ctx.dir, gitBranch: branch };
    }
    if (policy.push && isProtected(branch)) {
      throw new Error(`git: refusing to push to "${branch}" — add 'work on a branch' (never push to a protected branch)`);
    }
    const outcomes: LoopOutcome[] = [];
    for (const def of file.definitions) outcomes.push(await runDefinition(def, o));
    const allOk = outcomes.every((x) => x.satisfied);
    if (allOk && policy.commit === "done") await gitCommit(o, `loop: ${slug(file.definitions[0] && (file.definitions[0] as any).name)} — goal met`);
    if (allOk && policy.push) { await o.git!.push({ branch, dir: o.baseDir }); emit(o, { type: "git", action: "push", detail: branch }); }
    if (allOk && policy.openPr) { const url = await o.git!.openPr({ title: `loop: ${branch}`, branch, dir: o.baseDir }); emit(o, { type: "git", action: "pr", detail: url ?? branch }); }
    return outcomes;
  }
  const outcomes: LoopOutcome[] = [];
  for (const def of file.definitions) outcomes.push(await runDefinition(def, opts));
  return outcomes;
}
```
  - **Cadence `cycle`:** in `executeLoop`, after the `for (const step of cycleSteps)` block and before computing the transition, add:
```ts
    if (opts.git && resolveGit(opts.gitPolicy, loop.git).commit === "cycle") {
      await gitCommit(opts, `loop: ${loop.name ?? "cycle"} — cycle ${attempts}`);
    }
```
  - **Cadence `story`:** in `executePipeline`, after a satisfied stage (`if (outcome.satisfied)` path, before the loop continues), and in `executeFlow` after a satisfied step, add:
```ts
    if (opts.git && resolveGit(opts.gitPolicy).commit === "story") {
      await gitCommit(opts, `loop: story "${stage.name}" satisfied`);   // executeFlow: use step.name
    }
```
  (Per-loop `git` only refines `commit` cadence for `cycle`; `story` uses the run policy.)
- [ ] **Step 4: Run → passes** — build + `npm test -w @loop/runtime`; all green (existing + 5 new).
- [ ] **Step 5: Commit** — `feat(runtime): engine git hooks — isolation, commit cadence, push/PR, safety` + trailer.

---

### Task 5: Real `GitIO` (shell) + CLI wiring + git event trace

**Files:**
- Create: `packages/runtime/src/runners/shellGit.ts` (`ShellGitIO`)
- Modify: `packages/runtime/src/index.ts` (export `ShellGitIO`)
- Modify: `packages/runtime/src/cli.ts` (wire `git` into both `run(...)` calls; render `git` events)

**Interfaces:** Consumes `GitIO`/`isProtected` (Task 3). Produces `ShellGitIO`. CLI passes `git: new ShellGitIO()` and resolves the file's `config.git` to decide whether git is active.

- [ ] **Step 1: Implement `ShellGitIO`** — shells real git/gh via `node:child_process` (mirror `verify.ts`'s `exec` wrapper + trust-model comment):
  - `start`: `branch` → `git checkout -b <name>` (auto-name from the loop if `branch` unset, deduped); `worktree` → `git worktree add <dir> -b <name>` under `.worktrees/` and return that dir; `in-place` → return `{ dir: baseDir, branch: <git rev-parse --abbrev-ref HEAD> }`.
  - `commit`: `git add -A && git commit -m <message> --no-verify` (skip if nothing staged).
  - `push`: **throw if `isProtected(branch)`**, else `git push -u origin <branch>`.
  - `openPr`: `gh pr create --fill --head <branch>` (return the URL, or null if `gh` missing).
  - All run with `cwd: dir`. Keep the same trust-model note as `verify.ts`.
- [ ] **Step 2: CLI wiring** — in `cli.ts`, construct `const git = new ShellGitIO();` and add `git,` to BOTH `run(...)` option objects (the `--events` branch and the default branch). Add `git` event cases to the `render(e)` switch:
```ts
    case "git": return `  ⎇ git ${e.action}: ${e.detail}`;
```
- [ ] **Step 3: Verify** — `npm run build -w @loop/parser -w @loop/runtime`; `node packages/runtime/dist/cli.js parse <a git example>` shows `config.git`; full `npm test` green. (A real `loop run` needs git + claude; exercised manually — note in report.)
- [ ] **Step 4: Commit** — `feat(cli): real ShellGitIO + git event trace` + trailer.

---

### Task 6: SKILL.md + docs + example + tutorial

**Files:**
- Modify: `.claude/skills/loop/SKILL.md`
- Modify: `README.md`, `AGENTS.md`, `docs/MANUAL.md`
- Create: `examples/git_policy.loop`
- Modify: `docs/tutorial.html` (a "Git strategy" section)

- [ ] **Step 1: Example** — `examples/git_policy.loop`:
```loop
# Safe-by-default git: even with no git block, Loop works on a branch and commits
# when the goal is met (never pushes to main). This file opts into push + a PR.
git:
  work on a branch
  commit when the goal is met
  push when done
  open a pull request

loop "add a healthcheck endpoint":
  goal: GET /healthz returns 200 with a JSON status
  done when "pnpm test health" passes
  look at: the http server and the routes module, and the last failure
  each cycle: plan, then act, then observe
  when it fails: reflect, then plan again
  after 6 tries: stop and warn "healthcheck stuck"
```
- [ ] **Step 2: SKILL.md** — document the `git:` block, the **built-in default** (branch + commit-on-done, no push), the **cascade** (built-in → file → per-loop), and the **always-on safety** (never push to main/master). State that the in-chat runner performs the git ops itself and must refuse a protected-branch push.
- [ ] **Step 3: Docs** — `README.md` (vocabulary + a short git note), `AGENTS.md` (a `git:` reference entry: all line forms, cascade, safety, default), `docs/MANUAL.md` (a "Git strategy" subsection).
- [ ] **Step 4: Tutorial** — add a "Git strategy" section to `docs/tutorial.html` (TOC + section) covering the default, the block, and never-push-to-main. Keep the highlighter happy (add `git`/`commit`/`push`/`branch`/`worktree`/`pull request` to the `KW` list in the page's tokenizer so the new keywords colorize).
- [ ] **Step 5: Verify** — `node packages/runtime/dist/cli.js parse examples/git_policy.loop` shows `config.git`; `npm run build && npm test` all green.
- [ ] **Step 6: Commit** — `docs: document the git policy + example + tutorial section` + trailer.

---

## Self-Review

**Spec coverage:** NL references → Task 1 ✓. GitPolicy IR + `git:` block (file + loop) + schema → Task 2 ✓. Cascade `resolveGit` + GitIO + mock + RunOptions + events → Task 3 ✓. Engine hooks (setup/cadence/push/PR/safety) + backward-compat guard → Task 4 ✓. Real ShellGitIO + CLI + trace → Task 5 ✓. SKILL.md/docs/example/tutorial → Task 6 ✓. Built-in default (branch+commit, no push) → Task 3 `BUILTIN_GIT` + Task 4. Never-push-to-main → Task 3 `isProtected` + mock/shell `push` throw + Task 4 up-front error.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `GitPolicy` fields (isolation/branch/commit/push/openPr) identical across parser, schema, resolveGit, mock, engine. `GitIO` method shapes identical in interface, mock, shell impl, engine calls. `resolveGit(...levels)` returns `ResolvedGit` used consistently. `RunOptions.git/gitPolicy/gitBranch/gitStarted` and the `git` LoopEvent used consistently across engine + CLI.

**Deferred (note for the final review, not v1):** per-loop `git:` overriding push/PR/isolation (v1 per-loop refines `commit` cadence only); a configurable protected-branch set beyond main/master.
