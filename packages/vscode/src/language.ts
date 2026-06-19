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
  { label: "use", insert: "use the ${1:BMAD} method", detail: "select a preset/method", doc: "Pull in a method preset (e.g. `use the BMAD method`)." },
  { label: "schedule", insert: "schedule: ${1:nightly}", detail: "when it runs", doc: "manual · nightly · on push · a cron expression." },
  { label: "runner", insert: "run with ${1:claude code}", detail: "execution backend", doc: "Which agent executes the loop. Default: claude code." },
  { label: "target", insert: "target: ${1:./src}", detail: "working directory", doc: "Directory the loop operates in." },
];

const LOOP_BODY: Suggestion[] = [
  { label: "goal:", insert: "goal: ${1:what done means}", detail: "the objective", doc: "What 'done' means, in plain language." },
  { label: "done when", insert: 'done when the test "${1:file::name}" passes', detail: "verification predicate", doc: 'How the loop verifies itself: `done when the test "x" passes` · `done when "<cmd>" passes` · `done when "<cmd>" finds nothing`.' },
  { label: "look at:", insert: "look at: ${1:fileA, fileB}, and the last failure", detail: "context to read", doc: "Files the agent should read before acting — scope it to your architecture." },
  { label: "allow / ask", insert: "allow edits automatically, but ask me before ${1:migrations or pushes}", detail: "action policy", doc: "Which actions run automatically vs pause for confirmation." },
  { label: "each cycle:", insert: "each cycle: plan, then act, then observe", detail: "the repeated steps", doc: "The cycle, any subset of plan / act / observe, in order." },
  { label: "also:", insert: "also: ${1:polish, run a security check}", detail: "finishing passes", doc: "Extra passes run after the goal is met (skipped on failure)." },
  { label: "when it fails:", insert: "when it fails: reflect on ${1:why}, then plan again", detail: "the back-edge", doc: "On a failed observe: reflect, then re-enter the cycle. This is the feedback loop." },
  { label: "when it passes:", insert: "when it passes and the goal is met: stop", detail: "success transition", doc: "Stop once the predicate passes." },
  { label: "when blocked:", insert: "when blocked: ask a human", detail: "blocked transition", doc: "Pause for a person when the agent is stuck." },
  { label: "after N tries:", insert: 'after ${1:6} tries: stop and warn "${2:thrashing}"', detail: "thrash guard", doc: "Stop after N attempts so the loop can't spin forever." },
  { label: "a human approves the plan first", insert: "a human approves the plan first", detail: "human plan gate", doc: "A person approves the plan before the agent acts." },
  { label: "a human reviews before stopping", insert: "a human reviews before stopping", detail: "human review gate", doc: "A person judges the result before the loop may stop." },
  { label: "plan from archon", insert: 'plan from the archon project "${1:project}"', detail: "source the plan from Archon", doc: "Pull the plan from an Archon project instead of generating it." },
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

export function completionsFor(ctx: Context): Suggestion[] {
  if (ctx === "top") return TOP;
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
  done: "**done when** — the predicate the loop checks: a test, a shell command (`passes` / `finds nothing`), or a human.",
  "look": "**look at** — files the agent reads before acting; scope it to the relevant module.",
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
