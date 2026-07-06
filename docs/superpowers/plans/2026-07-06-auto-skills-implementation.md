# Auto Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified `skills:` keyword with `auto`, `ask`, `fixed`, and `none` modes, preserving old `use skills:` compatibility while giving the runtime an early skill-decision hook.

**Architecture:** Extend the parser IR with a `SkillPolicy` object and parse the new short-form `skills:` syntax in loop bodies. Add runtime skill-resolution plumbing as a small adapter interface and emit observable `skills` events before the first plan. Keep actual marketplace/generation as adapter behavior; this implementation defines the contract, policy semantics, parser validation, runtime eventing, and docs.

**Tech Stack:** TypeScript packages in npm workspaces, Node test runner, parser package `@loop-lang/parser`, runtime package `@loop-lang/runtime`, docs in Markdown/HTML source files.

## Global Constraints

- No dependency on external graph recommenders.
- No `.loop` syntax for choosing skill sources or generation fallback behavior.
- `skills:` is the single preferred source of truth for loop skill behavior.
- Existing `use skills:` loops continue to work during migration.
- If both `skills:` and `use skills:` appear in one loop, emit a clear parse error.
- `skills: none` cannot be combined with explicit skill names.
- `skills: auto, seo-audit` means `seo-audit` is a baseline skill and auto mode may add more.
- Runtime skill decisions happen early, before the first plan/implementation step.
- Auto mode must be observable through events even when it acts silently.

---

## File Structure

- Modify: `packages/parser/src/types.ts`
  - Add `SkillMode` and `SkillPolicy` types.
  - Add `skillPolicy?: SkillPolicy` to `Loop` while keeping `skills?: string[]` for compatibility.

- Modify: `packages/parser/src/parser.ts`
  - Add `parseSkillsLine(text, lineNo): SkillPolicy`.
  - Parse new `skills:` loop-body lines.
  - Reject duplicate `skills:` and mixed `skills:` + `use skills:` in a loop.
  - Preserve old `use skills:` by mapping it to both `loop.skills` and `loop.skillPolicy = { mode: "fixed", use: [...] }` only when no `skills:` line exists.

- Modify: `spec/loop-spec.schema.json`
  - Add schema fields for `skillPolicy.mode` and `skillPolicy.use`.

- Modify: `packages/runtime/src/types.ts`
  - Add `SkillDecisionInput`, `SkillDecisionResult`, `SkillProvider`, and `skills` loop event.
  - Add `skillProvider?: SkillProvider` to `RunOptions`.

- Modify: `packages/runtime/src/engine.ts`
  - Replace the current initial skill-set construction with a helper that resolves `skillPolicy`.
  - Call the optional `skillProvider` once before the first plan for `auto`/`ask`.
  - Merge baseline and provider-returned skills into plan/act inputs.
  - Emit skill-decision events.

- Modify: `packages/runtime/src/show.ts`
  - Render skill mode and baseline skills in `loop-run show` output.
  - Include skill behavior in `loop-run explain` prose.

- Modify tests:
  - `packages/parser/test/parser.test.js`
  - `packages/runtime/test/engine.test.js`
  - `packages/runtime/test/show.test.js`

- Modify docs:
  - `README.md`
  - `docs/MANUAL.md`
  - `AGENTS.md`
  - selected examples/templates that mention `use skills:` only if necessary for preferred syntax examples.

---

### Task 1: Parser IR and `skills:` short-form parsing

**Files:**
- Modify: `packages/parser/src/types.ts`
- Modify: `packages/parser/src/parser.ts`
- Test: `packages/parser/test/parser.test.js`

**Interfaces:**
- Produces: `export type SkillMode = "auto" | "ask" | "fixed" | "none"`.
- Produces: `export interface SkillPolicy { mode: SkillMode; use?: string[] }`.
- Produces: `loop.skillPolicy?: SkillPolicy`.
- Preserves: `loop.skills?: string[]` as the flattened enabled/baseline skill list for old runtime consumers.

- [ ] **Step 1: Add failing parser tests for new syntax**

Append these tests near the existing `// ---- skills + memory ----` section in `packages/parser/test/parser.test.js`:

```js
test("skills: auto parses to skillPolicy with no baseline skills", () => {
  const loop = parse('loop "x":\n  goal: g\n  skills: auto').definitions[0];
  assert.deepEqual(loop.skillPolicy, { mode: "auto" });
  assert.deepEqual(loop.skills, []);
});

test("skills: auto with explicit names treats names as baseline skills", () => {
  const loop = parse('loop "x":\n  goal: g\n  skills: auto, seo-audit, code-review').definitions[0];
  assert.deepEqual(loop.skillPolicy, { mode: "auto", use: ["seo-audit", "code-review"] });
  assert.deepEqual(loop.skills, ["seo-audit", "code-review"]);
});

test("skills: ask and fixed parse with explicit baseline skills", () => {
  const ask = parse('loop "x":\n  goal: g\n  skills: ask, payment-review').definitions[0];
  assert.deepEqual(ask.skillPolicy, { mode: "ask", use: ["payment-review"] });
  assert.deepEqual(ask.skills, ["payment-review"]);

  const fixed = parse('loop "y":\n  goal: g\n  skills: fixed, seo-audit').definitions[0];
  assert.deepEqual(fixed.skillPolicy, { mode: "fixed", use: ["seo-audit"] });
  assert.deepEqual(fixed.skills, ["seo-audit"]);
});

test("skills: none disables skills and rejects explicit names", () => {
  const loop = parse('loop "x":\n  goal: g\n  skills: none').definitions[0];
  assert.deepEqual(loop.skillPolicy, { mode: "none" });
  assert.deepEqual(loop.skills, []);

  assert.throws(
    () => parse('loop "bad":\n  goal: g\n  skills: none, seo-audit'),
    /skills: none cannot list explicit skills/i
  );
});

test("skills: rejects unknown modes and duplicate skill directives", () => {
  assert.throws(
    () => parse('loop "x":\n  goal: g\n  skills: maybe'),
    /skills: expected mode/i
  );
  assert.throws(
    () => parse('loop "x":\n  goal: g\n  skills: auto\n  skills: ask'),
    /only one skills directive/i
  );
  assert.throws(
    () => parse('loop "x":\n  goal: g\n  skills: auto\n  use skills: seo-audit'),
    /cannot combine skills: with use skills:/i
  );
});

test("legacy use skills maps to fixed skillPolicy", () => {
  const loop = parse('loop "x":\n  goal: g\n  use skills: a and b, c').definitions[0];
  assert.deepEqual(loop.skills, ["a", "b", "c"]);
  assert.deepEqual(loop.skillPolicy, { mode: "fixed", use: ["a", "b", "c"] });
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
npm --workspace packages/parser test
```

Expected: FAIL because `skillPolicy` and `skills:` parsing do not exist yet.

- [ ] **Step 3: Extend parser types**

In `packages/parser/src/types.ts`, add these exports near the existing skill-related comments:

```ts
export type SkillMode = "auto" | "ask" | "fixed" | "none";

export interface SkillPolicy {
  /** Dynamic skill policy: auto-add, ask-to-add, fixed explicit set, or none. */
  mode: SkillMode;
  /** Explicit baseline skills that are always available for this loop. */
  use?: string[];
}
```

Then update `Loop` by adding the new field immediately before the existing `skills?: string[]` field:

```ts
  /** Unified skill behavior for this loop. Preferred over legacy `use skills:` syntax. */
  skillPolicy?: SkillPolicy;
```

Keep the existing `skills?: string[]` field and comment, but adjust its comment to say it is the flattened baseline skill list used by older callers:

```ts
  /** Flattened baseline execution skills. Kept for compatibility with existing runtime callers. */
  skills?: string[];
```

- [ ] **Step 4: Add `parseSkillsLine` helper**

In `packages/parser/src/parser.ts`, import `SkillPolicy` from `./types.js` in the existing import list.

Add this helper above `interpretLoopBody`:

```ts
function parseSkillsLine(text: string, lineNo: number): SkillPolicy {
  const parts = text
    .split(/,|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean);
  const rawMode = parts.shift()?.toLowerCase();
  if (rawMode !== "auto" && rawMode !== "ask" && rawMode !== "fixed" && rawMode !== "none") {
    throw new ParseError(`skills: expected mode auto, ask, fixed, or none`, lineNo);
  }
  if (rawMode === "none" && parts.length > 0) {
    throw new ParseError(`skills: none cannot list explicit skills`, lineNo);
  }
  const policy: SkillPolicy = { mode: rawMode };
  if (parts.length > 0) policy.use = parts;
  return policy;
}
```

- [ ] **Step 5: Parse new `skills:` and guard legacy mixing**

In `interpretLoopBody`, add local flags after `let sawCycle = false;`:

```ts
  let sawSkillsDirective = false;
  let sawLegacyUseSkills = false;
```

Add this block before the existing `if ((m = t.match(/^use skills?:\s*(.+)$/i)))` block:

```ts
    if ((m = t.match(/^skills:\s*(.+)$/i))) {
      if (sawSkillsDirective) throw new ParseError(`only one skills directive is allowed`, ln.lineNo);
      if (sawLegacyUseSkills) throw new ParseError(`cannot combine skills: with use skills:`, ln.lineNo);
      const policy = parseSkillsLine(m[1], ln.lineNo);
      loop.skillPolicy = policy;
      loop.skills = policy.use ? [...policy.use] : [];
      sawSkillsDirective = true;
      i++; continue;
    }
```

Replace the existing legacy `use skills:` block with:

```ts
    if ((m = t.match(/^use skills?:\s*(.+)$/i))) {
      if (sawSkillsDirective) throw new ParseError(`cannot combine skills: with use skills:`, ln.lineNo);
      const names = m[1]
        .split(/,|\band\b/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      loop.skills = names;
      loop.skillPolicy = names.length ? { mode: "fixed", use: names } : { mode: "fixed" };
      sawLegacyUseSkills = true;
      i++; continue;
    }
```

- [ ] **Step 6: Run parser tests and build parser**

Run:

```bash
npm --workspace packages/parser test
npm --workspace packages/parser run build
```

Expected: PASS.

- [ ] **Step 7: Commit parser changes**

Run:

```bash
git add packages/parser/src/types.ts packages/parser/src/parser.ts packages/parser/test/parser.test.js packages/parser/dist

git commit -m "feat(parser): add unified skills syntax"
```

---

### Task 2: Schema support for `skillPolicy`

**Files:**
- Modify: `spec/loop-spec.schema.json`
- Test: parser/runtime build commands that consume types/schema manually in this repo.

**Interfaces:**
- Consumes: `Loop.skillPolicy` from Task 1.
- Produces: JSON Schema definition for serialized IR.

- [ ] **Step 1: Inspect the loop schema structure**

Read:

```bash
python3 - <<'PY'
import json
p='spec/loop-spec.schema.json'
s=json.load(open(p))
print(s.keys())
print(s.get('$defs', {}).keys())
PY
```

Expected: shows top-level schema and definitions so you can place `SkillPolicy` alongside existing loop definitions.

- [ ] **Step 2: Add schema definition and loop property**

Edit `spec/loop-spec.schema.json` to add a `SkillPolicy` definition equivalent to:

```json
"SkillPolicy": {
  "type": "object",
  "additionalProperties": false,
  "required": ["mode"],
  "properties": {
    "mode": { "enum": ["auto", "ask", "fixed", "none"] },
    "use": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    }
  }
}
```

Then add this property to the `Loop` definition's properties:

```json
"skillPolicy": { "$ref": "#/$defs/SkillPolicy" }
```

Do not remove the existing `skills` property.

- [ ] **Step 3: Validate JSON parses**

Run:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('spec/loop-spec.schema.json','utf8')); console.log('schema ok')"
```

Expected: `schema ok`.

- [ ] **Step 4: Commit schema change**

Run:

```bash
git add spec/loop-spec.schema.json
git commit -m "feat(schema): describe unified skill policy"
```

---

### Task 3: Runtime skill provider contract and early resolution

**Files:**
- Modify: `packages/runtime/src/types.ts`
- Modify: `packages/runtime/src/engine.ts`
- Test: `packages/runtime/test/engine.test.js`

**Interfaces:**
- Consumes: `Loop.skillPolicy` and `Loop.skills`.
- Produces: `SkillProvider.resolve(input): Promise<SkillDecisionResult>`.
- Produces event: `{ type: "skills", action: "resolve", mode, baseline, added, final, ok, detail? }`.

- [ ] **Step 1: Add failing runtime tests for fixed/none/auto/ask behavior**

Append these tests near the existing runtime skill-related tests in `packages/runtime/test/engine.test.js`:

```js
test("skills fixed passes only baseline skills to plan and act", async () => {
  const def = parse('loop "x":\n  goal: g\n  skills: fixed, seo-audit\n  done when "true" passes').definitions[0];
  const runner = new MockRunner();
  await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/p",
  });
  assert.deepEqual(runner.planCalls[0].skills, ["seo-audit"]);
  assert.deepEqual(runner.actCalls[0].skills, ["seo-audit"]);
});

test("skills none passes no skills even when a provider is attached", async () => {
  const def = parse('loop "x":\n  goal: g\n  skills: none\n  done when "true" passes').definitions[0];
  const runner = new MockRunner();
  let called = false;
  await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/p",
    skillProvider: { resolve: async () => { called = true; return { add: ["extra"] }; } },
  });
  assert.equal(called, false);
  assert.deepEqual(runner.planCalls[0].skills, []);
  assert.deepEqual(runner.actCalls[0].skills, []);
});

test("skills auto calls provider before first plan and merges safe additions", async () => {
  const def = parse('loop "x":\n  goal: hard payment feature\n  skills: auto, seo-audit\n  done when "true" passes').definitions[0];
  const runner = new MockRunner();
  const { events, onEvent } = collect();
  const calls = [];
  await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/p",
    onEvent,
    skillProvider: {
      resolve: async (input) => {
        calls.push(input);
        return { add: ["payment-idempotency"], detail: "trusted source" };
      },
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "auto");
  assert.deepEqual(calls[0].baseline, ["seo-audit"]);
  assert.deepEqual(runner.planCalls[0].skills, ["seo-audit", "payment-idempotency"]);
  assert.deepEqual(runner.actCalls[0].skills, ["seo-audit", "payment-idempotency"]);
  const skillEvent = events.find((e) => e.type === "skills" && e.action === "resolve");
  assert.deepEqual(skillEvent.final, ["seo-audit", "payment-idempotency"]);
  assert.equal(skillEvent.ok, true);
});

test("skills ask calls provider with ask mode and merges approved provider additions", async () => {
  const def = parse('loop "x":\n  goal: hard payment feature\n  skills: ask\n  done when "true" passes').definitions[0];
  const runner = new MockRunner();
  await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/p",
    skillProvider: {
      resolve: async (input) => {
        assert.equal(input.mode, "ask");
        return { add: ["payment-review"] };
      },
    },
  });
  assert.deepEqual(runner.planCalls[0].skills, ["payment-review"]);
});

test("skills auto degrades to baseline when provider throws", async () => {
  const def = parse('loop "x":\n  goal: g\n  skills: auto, seo-audit\n  done when "true" passes').definitions[0];
  const runner = new MockRunner();
  const { events, onEvent } = collect();
  await runDefinition(def, {
    runner,
    verifier: new SeqVerifier([true]),
    human: new ScriptedHumanIO(),
    baseDir: "/p",
    onEvent,
    skillProvider: { resolve: async () => { throw new Error("registry down"); } },
  });
  assert.deepEqual(runner.planCalls[0].skills, ["seo-audit"]);
  const skillEvent = events.find((e) => e.type === "skills" && e.action === "resolve");
  assert.equal(skillEvent.ok, false);
  assert.match(skillEvent.detail, /registry down/);
});
```

- [ ] **Step 2: Run runtime tests and verify failure**

Run:

```bash
npm --workspace packages/runtime test
```

Expected: FAIL because `skillProvider` and `skills` events do not exist yet.

- [ ] **Step 3: Add runtime types**

In `packages/runtime/src/types.ts`, extend the parser import:

```ts
import type { Loop, Predicate, SkillMode } from "@loop-lang/parser";
```

Add these interfaces after `SkillVerifyInput`:

```ts
export interface SkillDecisionInput {
  mode: Exclude<SkillMode, "fixed" | "none">;
  goal: string;
  baseline: string[];
  doneWhen?: Predicate[];
  files: string[];
  baseDir: string;
}

export interface SkillDecisionResult {
  /** Skills to add to the loop's working set. Provider owns search/generation/approval policy. */
  add?: string[];
  /** Human-readable detail for logs/live UI. */
  detail?: string;
}

export interface SkillProvider {
  resolve(input: SkillDecisionInput): Promise<SkillDecisionResult>;
  close?(): Promise<void>;
}
```

Add this event variant to `LoopEvent` near the other skill/recommendation events:

```ts
  | { type: "skills"; action: "resolve"; mode: "auto" | "ask" | "fixed" | "none"; baseline: string[]; added: string[]; final: string[]; ok: boolean; detail?: string }
```

Add this option to `RunOptions` near the existing skill recommender fields:

```ts
  /** Optional runtime skill resolver for `skills: auto` / `skills: ask`. */
  skillProvider?: SkillProvider;
```

- [ ] **Step 4: Add early skill resolution helper in engine**

In `packages/runtime/src/engine.ts`, replace this line:

```ts
  const skills: string[] = [...(loop.skills ?? [])];
```

with:

```ts
  const explicitSkillPolicy = loop.skillPolicy;
  const skillMode = explicitSkillPolicy?.mode ?? ((loop.skills?.length ?? 0) > 0 ? "fixed" : "fixed");
  const skills: string[] = [...(explicitSkillPolicy?.use ?? loop.skills ?? [])];
```

After `mergeSkills`, add this helper:

```ts
  const resolveDynamicSkills = async (): Promise<void> => {
    const baseline = [...skills];
    if (skillMode === "none" || skillMode === "fixed") {
      emit(opts, { type: "skills", action: "resolve", mode: skillMode, baseline, added: [], final: [...skills], ok: true });
      return;
    }
    if (!opts.skillProvider) {
      emit(opts, { type: "skills", action: "resolve", mode: skillMode, baseline, added: [], final: [...skills], ok: true, detail: "no skill provider attached" });
      return;
    }
    try {
      const res = await opts.skillProvider.resolve({
        mode: skillMode,
        goal: loop.goal,
        baseline,
        doneWhen: loop.doneWhen,
        files,
        baseDir: opts.baseDir,
      });
      const added = mergeSkills(res.add);
      emit(opts, { type: "skills", action: "resolve", mode: skillMode, baseline, added, final: [...skills], ok: true, detail: res.detail });
    } catch (err) {
      emit(opts, { type: "skills", action: "resolve", mode: skillMode, baseline, added: [], final: [...skills], ok: false, detail: String((err as Error)?.message ?? err) });
    }
  };
```

Call it before memory read and before the first plan, so it happens before implementation begins:

```ts
  await resolveDynamicSkills();
```

Place the call after `writeMemory` helper and before the `grantedConfirm` setup, or earlier if TypeScript scoping requires. Ensure `files` and `mergeSkills` are already defined before the call.

- [ ] **Step 5: Ensure plan/act use final skills**

Verify existing `runner.plan` and `runner.act` calls still pass `skills`. If they pass `skills` by reference, no change is needed because `mergeSkills` mutates the array before first plan. If they copy earlier, update to pass `skills: [...skills]` at call time.

- [ ] **Step 6: Run runtime tests and build**

Run:

```bash
npm --workspace packages/runtime test
npm --workspace packages/runtime run build
```

Expected: PASS.

- [ ] **Step 7: Commit runtime skill resolution**

Run:

```bash
git add packages/runtime/src/types.ts packages/runtime/src/engine.ts packages/runtime/test/engine.test.js packages/runtime/dist

git commit -m "feat(runtime): resolve unified skill policy before planning"
```

---

### Task 4: Show/explain output for skill policies

**Files:**
- Modify: `packages/runtime/src/show.ts`
- Test: `packages/runtime/test/show.test.js`

**Interfaces:**
- Consumes: `Loop.skillPolicy`.
- Produces: visible CLI output that makes skill mode obvious.

- [ ] **Step 1: Add failing show/explain tests**

Append to `packages/runtime/test/show.test.js`:

```js
test("show renders skill mode and baseline skills", () => {
  const file = parse('loop "x":\n  goal: g\n  skills: auto, seo-audit\n  done when "true" passes');
  const out = renderFile(file);
  assert.match(out, /skills: auto \+ seo-audit/);
});

test("explain describes auto skill behavior", () => {
  const loop = parse('loop "x":\n  goal: g\n  skills: auto, seo-audit\n  done when "true" passes').definitions[0];
  const out = explainDef(loop);
  assert.match(out, /starts with seo-audit/i);
  assert.match(out, /may add more skills automatically/i);
});
```

- [ ] **Step 2: Run show tests and verify failure**

Run:

```bash
npm --workspace packages/runtime test -- show
```

If the workspace script does not support test filtering, run:

```bash
node packages/runtime/test/show.test.js
```

Expected: FAIL.

- [ ] **Step 3: Render skills in `renderLoop`**

In `packages/runtime/src/show.ts`, add this helper near `guard`:

```ts
function skillPolicyStr(loop: Loop): string | null {
  const policy = loop.skillPolicy;
  if (!policy) return loop.skills?.length ? `fixed + ${loop.skills.join(", ")}` : null;
  const use = policy.use?.length ? ` + ${policy.use.join(", ")}` : "";
  return `${policy.mode}${use}`;
}
```

In `renderLoop`, after hook rendering and before knowledge/examples, add:

```ts
  const sp = skillPolicyStr(loop);
  if (sp) L.push(`   🧰 skills: ${sp}`);
```

- [ ] **Step 4: Explain skills in prose**

In `explainLoop`, after the done-when sentence, add:

```ts
  if (loop.skillPolicy) {
    const names = loop.skillPolicy.use ?? [];
    if (loop.skillPolicy.mode === "auto") {
      L.push(names.length ? `It starts with ${names.join(", ")} and may add more skills automatically.` : `It may add useful skills automatically before it starts implementation.`);
    } else if (loop.skillPolicy.mode === "ask") {
      L.push(names.length ? `It starts with ${names.join(", ")} and asks before adding more skills.` : `It asks before adding useful skills.`);
    } else if (loop.skillPolicy.mode === "fixed") {
      L.push(names.length ? `It uses only these skills: ${names.join(", ")}.` : `It does not dynamically add skills.`);
    } else if (loop.skillPolicy.mode === "none") {
      L.push(`It does not use skills.`);
    }
  } else if (loop.skills?.length) {
    L.push(`It uses these skills: ${loop.skills.join(", ")}.`);
  }
```

- [ ] **Step 5: Run show tests and build runtime**

Run:

```bash
npm --workspace packages/runtime test
npm --workspace packages/runtime run build
```

Expected: PASS.

- [ ] **Step 6: Commit show/explain changes**

Run:

```bash
git add packages/runtime/src/show.ts packages/runtime/test/show.test.js packages/runtime/dist

git commit -m "feat(runtime): show unified skill policy"
```

---

### Task 5: Documentation migration to unified `skills:` keyword

**Files:**
- Modify: `README.md`
- Modify: `docs/MANUAL.md`
- Modify: `AGENTS.md`
- Optionally modify: `examples/skills_memory.loop`, `seo.loop`, `seo-content.loop` if examples should demonstrate preferred syntax now.

**Interfaces:**
- Consumes: semantics from the design spec.
- Produces: user-facing docs that make `skills:` the preferred keyword.

- [ ] **Step 1: Update README skills section**

In `README.md`, replace the current skills paragraph around `## Skills and memory` with text equivalent to:

```md
## Skills and memory

A loop can use skills through one `skills:` keyword:

```loop
skills: auto                         # discover/add useful skills with minimum friction
skills: ask                          # recommend additions, ask before adding
skills: fixed, seo-audit             # use only these explicit skills
skills: none                         # use no skills
skills: auto, seo-audit              # start with seo-audit, auto-add more if useful
```

`auto` runs an early capability check before implementation. It may use installed skills, trusted installable skills, or temporary generated skills, and it logs what it added. It only interrupts for risky actions such as untrusted sources, broad capabilities, or permanent generated skills. Existing `use skills:` loops still work, but `skills:` is preferred.
```

Do not mention external graph recommenders.

- [ ] **Step 2: Update manual grammar/reference**

In `docs/MANUAL.md`, add `skills: auto | ask | fixed, <names> | none` to the grammar/reference section. Include the examples:

```loop
skills: auto
skills: ask
skills: fixed, check-weather, analyze-workout
skills: none
skills: auto, seo-audit
```

State explicitly:

- explicit names are baseline skills;
- `auto` may add more;
- `ask` asks before adding;
- `fixed` never adds more;
- `none` cannot list names;
- `use skills:` remains legacy-compatible but should not be mixed with `skills:`.

- [ ] **Step 3: Update AGENTS authoring grammar**

In `AGENTS.md`, replace the vocabulary line:

```md
use skills: <a>, <b>      named skills the loop may invoke during plan/act
```

with:

```md
skills: auto | ask | fixed, <a>, <b> | none   unified skill policy: auto-add, ask-to-add, fixed explicit skills, or no skills
```

Then update the skills section to say `use skills:` is legacy syntax equivalent to `skills: fixed, ...`.

- [ ] **Step 4: Update one example to preferred syntax**

Change `examples/skills_memory.loop` from:

```loop
  use skills: check-weather, analyze-workout
```

to:

```loop
  skills: fixed, check-weather, analyze-workout
```

If `seo.loop` contains `use skills: seo-audit`, change it to:

```loop
  skills: fixed, seo-audit
```

- [ ] **Step 5: Run parser examples and full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit docs/examples**

Run:

```bash
git add README.md docs/MANUAL.md AGENTS.md examples/skills_memory.loop seo.loop seo-content.loop

git commit -m "docs: document unified skills policy"
```

If `seo-content.loop` is unchanged, remove it from the `git add` command.

---

### Task 6: Final verification and compatibility check

**Files:**
- No planned source changes unless verification reveals an issue.

**Interfaces:**
- Verifies all prior tasks together.

- [ ] **Step 1: Run full build**

Run:

```bash
npm run build
```

Expected: all workspaces build successfully.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: all workspace tests pass.

- [ ] **Step 3: Manually verify parser output for representative snippets**

Run:

```bash
node --input-type=module - <<'JS'
import { parse } from './packages/parser/dist/index.js';
for (const src of [
  'loop "a":\n  goal: g\n  skills: auto',
  'loop "b":\n  goal: g\n  skills: ask, review-skill',
  'loop "c":\n  goal: g\n  skills: fixed, seo-audit',
  'loop "d":\n  goal: g\n  skills: none',
  'loop "e":\n  goal: g\n  use skills: legacy-skill',
]) {
  const loop = parse(src).definitions[0];
  console.log(loop.name, JSON.stringify(loop.skillPolicy), JSON.stringify(loop.skills));
}
JS
```

Expected output includes:

```text
a {"mode":"auto"} []
b {"mode":"ask","use":["review-skill"]} ["review-skill"]
c {"mode":"fixed","use":["seo-audit"]} ["seo-audit"]
d {"mode":"none"} []
e {"mode":"fixed","use":["legacy-skill"]} ["legacy-skill"]
```

- [ ] **Step 4: Manually verify show output**

Run:

```bash
cat > /tmp/auto-skills.loop <<'EOF'
loop "auto skills demo":
  goal: demonstrate skill policy
  skills: auto, seo-audit
  done when "true" passes
EOF
node packages/runtime/dist/cli.js show /tmp/auto-skills.loop
```

Expected: output contains `skills: auto + seo-audit`.

- [ ] **Step 5: Confirm no unwanted external-recommender coupling in new feature text**

Run:

```bash
rg -n "external graph|graph recommender|depends on external" README.md docs/MANUAL.md AGENTS.md docs/superpowers/specs/2026-07-06-auto-skills-design.md docs/superpowers/plans/2026-07-06-auto-skills-implementation.md
```

Expected: no new auto-skills text describes this feature as depending on an external graph recommender.

- [ ] **Step 6: Final commit if verification required fixes**

If Step 1–5 required changes, commit them:

```bash
git add <changed files>
git commit -m "fix: finalize unified skills policy"
```

If no files changed, do not create an empty commit.
