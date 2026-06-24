/**
 * Pure language intelligence for Loop — no vscode dependency, so it can be unit
 * tested. The extension's completion / prediction / hover providers wrap these.
 * Deterministic, grammar-driven IDE assistance: the pre-agent IntelliSense feel.
 */

export type Context = "top" | "loop-body" | "stage-body" | "pipeline";

export interface Suggestion {
  label: string;
  /** Snippet text; `$1`/`$0` are tab stops (VSCode SnippetString syntax). */
  insert: string;
  detail: string;
  doc: string;
  /** "template" = a whole best-practice pattern (shown as a Snippet, ranked first); default a single construct. */
  kind?: "construct" | "template";
}

const indent = (s: string): number => s.length - s.trimStart().length;
const isBlank = (s: string): boolean => s.trim() === "" || s.trim().startsWith("#");
const keyword = (s: string): string => s.trim().split(/[\s:"]/)[0].toLowerCase();

/**
 * Determine the structural context for the line at `idx`, by walking up to the
 * nearest less-indented header (loop / stage / pipeline).
 */
export function contextAt(lines: string[], idx: number): Context {
  const cur = indent(lines[idx] ?? "");
  for (let i = idx - 1; i >= 0; i--) {
    const ln = lines[i];
    if (isBlank(ln)) continue;
    if (indent(ln) < cur) {
      const kw = keyword(ln);
      if (kw === "pipeline") return "pipeline";
      if (kw === "stage") return "stage-body";
      if (kw === "loop") return "loop-body";
      // some other shallower line; keep climbing for a real header
    }
  }
  return "top";
}

const TOP: Suggestion[] = [
  { label: "loop", insert: 'loop "${1:name}":\n  goal: ${2:what done means}\n  done when ${3:the test "x" passes}\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n', detail: "a self-correcting loop", doc: "A loop: plan → act → observe, reflecting on failure until `done when` is satisfied." },
  { label: "pipeline", insert: 'pipeline "${1:name}":\n  stage "${2:story}":\n    goal: ${3:...}\n    each cycle: plan, then act, then observe\n', detail: "a sequence of stages", doc: "A pipeline runs stages in order; a failing stage halts the rest. An epic → a pipeline, each story → a stage." },
  { label: "flow", insert: 'flow "${1:name}":\n  run "${2:first.loop}"\n  then run "${3:next.loop}"\n', detail: "chain of .loop files", doc: "Runs whole .loop files in order; each file's text summary carries forward. Fail-fast." },
  { label: "for each", insert: 'for each ${1:item} in "${2:plan.yaml}":\n  run "${3:template.loop}"', detail: "iterate a plan, run a template per item", doc: "Inside a flow: enumerate items from a .yaml/.md file and run the template once per item (item text → context); pauses to ask continue/stop on a failed item." },
  { label: "use", insert: "use the ${1:BMAD} method", detail: "select a preset/method", doc: "Pull in a method preset (e.g. `use the BMAD method`)." },
  { label: "schedule", insert: "schedule: ${1:nightly}", detail: "when it runs", doc: "manual · nightly · on push · a cron expression." },
  { label: "runner", insert: "run with ${1:claude code}", detail: "execution backend", doc: "Which agent executes the loop. Default: claude code." },
  { label: "target", insert: "target: ${1:./src}", detail: "working directory", doc: "Directory the loop operates in." },
];

const LOOP_BODY: Suggestion[] = [
  { label: "goal:", insert: "goal: ${1:what done means}", detail: "the objective", doc: "What 'done' means, in plain language." },
  { label: "done when", insert: 'done when the test "${1:file::name}" passes', detail: "verification predicate", doc: 'How the loop verifies itself: `done when the test "x" passes` · `done when "<cmd>" passes` · `done when "<cmd>" finds nothing` · `done when the skill "review" approves`.' },
  { label: "done when the skill", insert: 'done when the skill "${1:review}" approves', detail: "skill-as-verifier", doc: 'A review skill judges the goal and returns a verdict: `done when the skill "x" approves` or `done when the skill "x" scores 8 or more`. Bridges an abstract goal to a verifiable check.' },
  { label: "look at:", insert: "look at: ${1:fileA, fileB}, and the last failure", detail: "context to read", doc: "Files the agent should read before acting — scope it to your architecture." },
  { label: "use skills:", insert: "use skills: ${1:skill-a, skill-b}", detail: "execution skills", doc: "Named skills the loop may invoke during plan/act — coordinate proven skills instead of one mega-prompt." },
  { label: "remember in", insert: 'remember in "${1:loop.memory.md}"', detail: "cross-run memory", doc: "A markdown file the loop reads on start (its lessons feed the first plan) and appends an outcome entry to on stop." },
  { label: "allow / ask", insert: "allow edits automatically, but ask me before ${1:migrations or pushes}", detail: "action policy", doc: "Which actions run automatically vs pause for confirmation." },
  { label: "each cycle:", insert: "each cycle: plan, then act, then observe", detail: "the repeated steps", doc: "The cycle, any subset of plan / act / observe, in order." },
  { label: "also:", insert: "also: ${1:polish, run a security check}", detail: "finishing passes", doc: "Extra passes run after the goal is met (skipped on failure)." },
  { label: "when it fails:", insert: "when it fails: reflect on ${1:why}, then plan again", detail: "the back-edge", doc: "On a failed observe: reflect, then re-enter the cycle. This is the feedback loop." },
  { label: "when it passes:", insert: "when it passes and the goal is met: stop", detail: "success transition", doc: "Stop once the predicate passes." },
  { label: "when blocked:", insert: "when blocked: ask a human", detail: "blocked transition", doc: "Pause for a person when the agent is stuck." },
  { label: "after N tries:", insert: 'after ${1:6} tries: stop and warn "${2:thrashing}"', detail: "thrash guard", doc: "Stop after N attempts so the loop can't spin forever." },
  { label: "a human approves the plan first", insert: "a human approves the plan first", detail: "human plan gate", doc: "A person approves the plan before the agent acts." },
  { label: "a human reviews before stopping", insert: "a human reviews before stopping", detail: "human review gate", doc: "A person judges the result before the loop may stop." },
  { label: "plan from a file", insert: 'plan from "${1:docs/plan.md}"', detail: "read the plan from a file", doc: "Read the plan from a file instead of having the agent generate it — the loop executes a plan you control." },
];

const STAGE_EXTRA: Suggestion = {
  label: "a human approves before",
  insert: "a human approves before ${1:provisioning}",
  detail: "stage gate",
  doc: "A blocking gate before the stage runs (e.g. before deploy).",
};

const PIPELINE: Suggestion[] = [
  { label: "stage", insert: 'stage "${1:story}":\n    goal: ${2:...}\n    each cycle: plan, then act, then observe\n', detail: "a pipeline stage", doc: "One stage of the pipeline; its body is a loop." },
];

/**
 * Whole, ready-to-fill best-practice patterns — the "drop it in and tab through
 * the holes" experience. Each is a complete, runnable shape: a real `done when`,
 * scoped `look at`, gates where the work is risky, and a thrash guard — so what
 * you scaffold already passes the soft linter. Surfaced only at the top level.
 */
const TEMPLATES: Suggestion[] = [
  { label: "bugfix — fix a failing test", kind: "template",
    detail: "the canonical self-correcting loop",
    doc: "Keep working until a real test passes: scoped context + last failure, reflect on failure, thrash guard.",
    insert: 'loop "fix ${1:the failing checkout tax test}":\n  goal: ${2:the tax line is correct at checkout}\n  done when ${3:the test "checkout.spec.ts::tax" passes}\n  look at: ${4:the checkout code}, and the last failure\n  each cycle: plan, then act, then observe\n  when it fails: reflect on which layer broke, then plan again\n  after ${5:6} tries: stop and warn "${6:stuck — needs a human}"\n$0' },

  { label: "feature — build behind a plan gate", kind: "template",
    detail: "plan-approved feature with tests",
    doc: "A feature where the plan is approved before any code, then built to a green test suite.",
    insert: 'loop "build ${1:the wishlist feature}":\n  goal: ${2:users can save items to a wishlist}\n  a human approves the plan first\n  look at: ${3:src/wishlist, the API}, and the last failure\n  allow edits automatically, but ask me before migrations or pushes\n  done when ${4:"pnpm test wishlist" passes}\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n  after 8 tries: stop and warn "${5:wishlist stuck}"\n$0' },

  { label: "gated — a risky change (migration/deploy)", kind: "template",
    detail: "ask-before + ask-a-human-when-blocked",
    doc: "Risky work gated: confirm the risky class, and ask a human when the agent is blocked.",
    insert: 'loop "${1:add the orders table}":\n  goal: ${2:the orders migration is applied and verified}\n  look at: ${3:the schema and the migrations folder}, and the last failure\n  allow edits automatically, but ask me before ${4:migrations or deploys}\n  done when ${5:"pnpm test db" passes}\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n  when blocked: ask a human\n  after 6 tries: stop and warn "${6:migration needs a human}"\n$0' },

  { label: "security — scan must find nothing", kind: "template",
    detail: "done when … finds nothing",
    doc: "A loop that finishes only when a scanner reports zero (exit 0 AND empty output).",
    insert: 'loop "${1:harden the API}":\n  goal: ${2:no high or critical vulnerabilities}\n  done when ${3:"semgrep --config auto --severity=high" finds nothing}\n  look at: ${4:the API and its middleware}, and the last failure\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n  after 4 tries: stop and warn "${5:security needs a human}"\n$0' },

  { label: "pipeline — an epic (stages in order)", kind: "template",
    detail: "security → build (gate) → review",
    doc: "An epic as a pipeline: each story a stage with its own check and gates; fail-fast.",
    insert: 'pipeline "${1:ship the feature}":\n\n  stage "${2:security}":\n    goal: ${3:no high or critical vulnerabilities}\n    done when "${4:semgrep --severity=high}" finds nothing\n    each cycle: plan, then act, then observe\n    when it fails: reflect, then plan again\n\n  stage "${5:build}":\n    goal: ${6:the feature works and tests pass}\n    a human approves the plan first\n    done when "${7:pnpm test}" passes\n    each cycle: plan, then act, then observe\n    when it fails: reflect, then plan again\n    after 8 tries: stop and warn "${8:build stuck}"\n\n  stage "${9:review}":\n    goal: ${10:the UI matches the design}\n    a human reviews before stopping\n    each cycle: plan, then act, then observe\n$0' },

  { label: "flow — chain build → test → deploy", kind: "template",
    detail: "whole .loop files, deploy gated",
    doc: "Chain separate .loop files in order; a text summary carries forward; the deploy waits for approval.",
    insert: 'flow "${1:ship}":\n  run "${2:build.loop}"\n  then run "${3:test.loop}"\n  then run "${4:deploy.loop}":\n    a human approves first\n$0' },

  { label: "for each — run a template per item", kind: "template",
    detail: "fan out over a plan file",
    doc: "Enumerate items from a .yaml/.md plan and run the template once per item.",
    insert: 'flow "${1:deliver}":\n  for each ${2:item} in "${3:plan.yaml}":\n    run "${4:item-template.loop}"\n$0' },

  { label: "A-to-Z — discover → design → for each story", kind: "template",
    detail: "the whole feature as one flow",
    doc: "Interactive discovery, a human-approved design, then the per-story checklist for every story.",
    insert: 'flow "${1:epic: authentication}":\n  run "${2:discover.loop}"\n  then run "${3:design.loop}"\n  then for each ${4:story} in "${5:sprint.yaml}":\n    run "${6:story-template.loop}"\n$0' },

  { label: "git — branch + commit + pull request", kind: "template",
    detail: "git policy, then a loop",
    doc: "A git: policy (work on a branch, commit on success, open a PR — never push to main) plus a loop.",
    insert: 'git:\n  work on a branch\n  commit when the goal is met\n  open a pull request\n\nloop "${1:add a healthcheck endpoint}":\n  goal: ${2:GET /healthz returns 200 with a JSON status}\n  done when ${3:"pnpm test health" passes}\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n  after 6 tries: stop and warn "${4:healthcheck stuck}"\n$0' },

  { label: "models — tier the model per phase", kind: "template",
    detail: "fast plan/reflect, strong act",
    doc: "Run the cheap phases on a fast model and act on a strong one — cheaper than one big prompt.",
    insert: 'models: fast ${1:haiku}, strong ${2:opus}\n\nloop "${3:fix the failing test}":\n  goal: ${4:the test passes}\n  done when ${5:"pnpm test" passes}\n  each cycle: plan, then act, then observe\n  when it fails: reflect, then plan again\n  after 6 tries: stop and warn "${6:stuck}"\n$0' },

  { label: "scheduled — config tier (method + schedule)", kind: "template",
    detail: "run a method on a schedule",
    doc: "The config tier: import a method and run it on a schedule against a target, notifying the team.",
    insert: 'use the ${1:audit} method\nschedule: ${2:nightly}\ntarget: ${3:./src}\nnotify: ${4:slack}\n$0' },
];

export function completionsFor(ctx: Context): Suggestion[] {
  if (ctx === "top") return [...TEMPLATES, ...TOP];
  if (ctx === "pipeline") return PIPELINE;
  if (ctx === "stage-body") return [...LOOP_BODY, STAGE_EXTRA];
  return LOOP_BODY;
}

/**
 * Predict the conventional next line given the previous non-empty line — the
 * "ghost text" you tab to accept. Returns null when there's nothing obvious.
 */
export function predictNext(prevLine: string | undefined): string | null {
  if (!prevLine) return null;
  const kw = keyword(prevLine);
  const head = prevLine.trim().toLowerCase();
  if (head.startsWith("loop ")) return "goal: ";
  if (head.startsWith("stage ")) return "goal: ";
  if (head.startsWith("pipeline ")) return 'stage "":';
  if (kw === "goal") return 'done when the test "" passes';
  if (head.startsWith("done when")) return "each cycle: plan, then act, then observe";
  if (head.startsWith("look at")) return "allow edits automatically, but ask me before migrations or pushes";
  if (head.startsWith("each cycle")) return "when it fails: reflect, then plan again";
  if (head.startsWith("when it fails")) return 'after 6 tries: stop and warn "thrashing"';
  return null;
}

const HOVERS: Record<string, string> = {
  loop: "**loop** — a self-correcting cycle: plan → act → observe, reflecting on failure until `done when` is met.",
  pipeline: "**pipeline** — stages run in order; a failing stage halts the rest. Epic → pipeline, story → stage.",
  stage: "**stage** — one stage of a pipeline; its body is a loop.",
  goal: "**goal** — what 'done' means, in plain language.",
  done: "**done when** — the predicate the loop checks: a test, a shell command (`passes` / `finds nothing`), a human, or a review skill (`the skill \"x\" approves` / `scores N or more`).",
  skill: "**the skill \"x\"** — a review skill judges the goal and returns a verdict (approved / a score), bridging an abstract goal to a verifiable check.",
  "look": "**look at** — files the agent reads before acting; scope it to the relevant module.",
  skills: "**use skills** — named skills the loop may invoke during plan/act; coordinate proven skills instead of one mega-prompt.",
  remember: "**remember in** — a markdown file the loop reads on start (past lessons feed the first plan) and appends an outcome entry to on stop. Cross-run memory.",
  each: "**each cycle** — the repeated steps (plan / act / observe, any subset, in order).",
  also: "**also** — extra finishing passes run after the goal is met (skipped on failure).",
  when: "**when …** — a transition evaluated after observe: `when it fails`, `when it passes …`, `when blocked`.",
  after: "**after N tries** — thrash guard: stop after N attempts.",
  reflect: "**reflect** — turn a failure into context for the next plan. The feedback edge.",
  use: "**use** — pull in a method preset, e.g. `use the BMAD method`.",
  schedule: "**schedule** — manual · nightly · on push · cron.",
};

export function hoverFor(word: string): string | null {
  return HOVERS[word.toLowerCase()] ?? null;
}

export const VOCABULARY = Object.keys(HOVERS);

// ---- soft lint: nudge toward a complete loop, never block ----

// Minimal structural shape of the parsed loop-spec (avoids a dependency on the parser).
interface LintLoop {
  kind: "loop";
  name: string | null;
  doneWhen?: unknown;
  humanReviewBeforeStop?: boolean;
  transitions?: Array<{ on: string; threshold?: number; do?: Array<{ action: string }> }>;
}
interface LintStage { name: string; loop: LintLoop }
interface LintPipeline { kind: "pipeline"; name: string; stages: LintStage[] }
interface LintFlow { kind: "flow"; name: string; steps: unknown[] }
interface LintFile { definitions: Array<LintLoop | LintPipeline | LintFlow> }

export interface LintWarning {
  line: number; // 0-based source line to attach the squiggle
  message: string;
}

/** Find the source line of a `loop "name":` / `stage "name":` header (best-effort). */
function headerLine(lines: string[], kind: "loop" | "stage", name: string | null): number {
  if (name) {
    const re = new RegExp(`^\\s*${kind}\\s+"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) return i;
  }
  const j = lines.findIndex((l) => new RegExp(`^\\s*${kind}\\b`).test(l));
  return Math.max(0, j);
}

function checkLoop(loop: LintLoop, line: number, out: LintWarning[]) {
  // Unverifiable: nothing decides "done" — only a thrash guard or the hard cap can stop it.
  if (!loop.doneWhen && !loop.humanReviewBeforeStop) {
    out.push({ line, message: "This loop has no way to verify it's done — add a `done when …` check or `a human reviews before stopping`." });
  }
  // Self-correcting but unbounded: re-plans on failure with no attempt ceiling.
  const reflects = (loop.transitions ?? []).some((t) => t.on === "fail" && (t.do ?? []).some((d) => d.action === "reflect" || d.action === "plan"));
  const guarded = (loop.transitions ?? []).some((t) => t.on === "attempts" && typeof t.threshold === "number");
  if (reflects && !guarded) {
    out.push({ line, message: "This loop re-plans on failure but has no thrash guard — add `after N tries: stop and warn \"…\"` (otherwise it runs to the hard cap of 25)." });
  }
}

/** Structural warnings for a parsed spec. Pure: takes the spec + source lines, returns nudges. */
export function lint(file: LintFile, lines: string[]): LintWarning[] {
  const out: LintWarning[] = [];
  for (const def of file.definitions ?? []) {
    if (def.kind === "pipeline") {
      for (const stage of def.stages ?? []) {
        checkLoop(stage.loop, headerLine(lines, "stage", stage.name), out);
      }
    } else if (def.kind === "loop") {
      checkLoop(def, headerLine(lines, "loop", def.name), out);
    }
    // flow: nothing to lint here — its referenced stories carry their own checks
  }
  return out;
}
