/**
 * TypeScript mirror of spec/loop-spec.schema.json — the open loop-spec IR.
 * Keep in sync with the JSON Schema; the schema is the source of truth.
 */

export const LOOP_VERSION = "0.1" as const;

export interface LoopFile {
  loopVersion: typeof LOOP_VERSION;
  config: Config | null;
  definitions: Definition[];
}

export type Definition = Pipeline | Loop | Flow;

export interface GitPolicy {
  isolation?: "in-place" | "branch" | "worktree";
  branch?: string;
  commit?: "done" | "cycle" | "story" | "never";
  push?: boolean;
  openPr?: boolean;
}

/**
 * Where a loop sits on the vibe-coding → agentic-engineering spectrum. A config-tier dial
 * that expands to bundled defaults (reflect-on-fail, a thrash guard) over every loop in the
 * file. `vibe coding` = no injected defaults (fast/disposable); `structured ai-assisted` and
 * `agentic engineering` = born with a back-edge + a guard unless the loop sets its own.
 */
export type Rigor = "vibe coding" | "structured ai-assisted" | "agentic engineering";

/** Run-isolation policy (`sandbox:` block): where code runs and what it cannot reach. */
export interface SandboxPolicy {
  /** Network posture: "none" (no egress) or "allowlist" (only `egress` hosts). */
  network?: "none" | "allowlist";
  /** Allowed egress hosts when network is "allowlist". */
  egress?: string[];
  /** Resource caps, as written (e.g. cpu "2 cores", memory "4g", time "10m"). */
  cpu?: string;
  memory?: string;
  time?: string;
}

/** Observability policy (`observe:` block): trace, cost metering, and an optional spend cap. */
export interface ObservePolicy {
  /** Emit a per-cycle trace and a stop-time OpEx report. */
  trace?: boolean;
  /** Meter tokens and cost per cycle (requires a provider that reports usage). */
  meter?: boolean;
  /** Stop and warn if spend exceeds this (e.g. "$5"). Enforced when the runner reports cost. */
  costCap?: string;
}

/** External defaults threaded into loop parsing (from the config tier or a project loop.config). */
export interface ParseDefaults {
  cycle?: CycleStep[];
  rigor?: Rigor;
}

export type ModelTier = "fast" | "strong";
export type ModelPhase = "plan" | "act" | "reflect" | "also";
export interface ModelPolicy {
  tiers?: { fast?: string; strong?: string };
  phases?: Partial<Record<ModelPhase, ModelTier>>;
}

export interface Config {
  /** Claude Code /loopflow dashboard opt-in from loop.config (`live=true` / `live=false`). */
  live?: boolean;
  use?: string;
  useOverrides?: OverrideEntry[];
  runner?: string;
  schedule?: string;
  target?: string;
  notify?: string;
  git?: GitPolicy;
  models?: ModelPolicy;
  /**
   * File-level default cycle (`each cycle: …` at the config tier). Applies to every
   * loop that doesn't declare its own `each cycle:`. A per-loop `each cycle:` overrides
   * it; with neither, the built-in default is plan → act → observe. Lowest wins, like git.
   */
  cycle?: CycleStep[];
  /** The spectrum dial (`rigor: …`) — bundles best-practice defaults over every loop in the file. */
  rigor?: Rigor;
  /** Supervision posture (`mode: …`): conductor = in-session/synchronous; orchestrator = async/reviews-outcomes. */
  mode?: "conductor" | "orchestrator";
  /** Observability (`observe:` block): trace + cost metering + an optional spend cap. */
  observe?: ObservePolicy;
  /** Run isolation (`sandbox:` block): where code runs and what it cannot reach. */
  sandbox?: SandboxPolicy;
  /** Identity the run executes as (`runs as: …`) — an auditable principal for unattended runs. */
  runsAs?: string;
}

export interface OverrideEntry {
  target: string;
  kind?: "stage" | "config";
  patch?: Record<string, unknown>;
}

export interface Pipeline {
  kind: "pipeline";
  name: string;
  stages: Stage[];
}

export interface Stage {
  name: string;
  gate?: { message: string } | null;
  loop: Loop;
  /** Stages sharing a parallel-group id run concurrently (`stages in parallel:`). */
  parallelGroup?: number;
}

export interface Loop {
  kind: "loop";
  name: string | null;
  goal: string;
  /**
   * Verification conditions — ALL must pass (a conjunction). A test/command predicate is a
   * deterministic check (a TEST); a skill predicate is an eval (an EVAL).
   * Each `done when …` line appends one. Empty/absent = no machine check (stop via a human path).
   */
  doneWhen?: Predicate[];
  context?: LoopContext;
  policy?: Policy;
  cycle: CycleStep[];
  /** Extra finishing passes run after the goal is met (e.g. "polish", "run a security check"). */
  also?: string[];
  /** Named execution skills the loop may invoke during plan/act (e.g. ["check-weather"]). */
  skills?: string[];
  /** MCP servers whose tools the loop may use (`use tools from the "github" server`). */
  tools?: string[];
  /** A markdown file the loop reads on start and appends to on stop — cross-run memory. */
  memory?: LoopMemory;
  planSource?: PlanSource;
  /** Deterministic checks bound to lifecycle points (`hooks:`). A failing hook blocks. */
  hooks?: Hook[];
  humanPlan?: boolean;
  humanReviewBeforeStop?: boolean;
  transitions?: Transition[];
  git?: GitPolicy;
  models?: ModelPolicy;
}

export type CycleStep = "plan" | "act" | "observe";

/** A lifecycle point a `hooks:` check binds to. */
export type HookPoint = "before-cycle" | "after-plan" | "after-act" | "after-observe" | "on-commit" | "on-push" | "on-stop";

/** A deterministic check bound to a lifecycle point — a failing hook blocks. */
export interface Hook {
  at: HookPoint;
  predicate: Predicate;
}

export interface LoopContext {
  files?: string[];
  docs?: string[];
  includeLastFailure?: boolean;
  /** Read-only reference material (`knowledge:`) — docs/diagrams the agent reads but must not edit. */
  knowledge?: string[];
  /** Reference patterns to imitate (`examples:`) — "build it like these". */
  examples?: string[];
}

export interface Policy {
  auto?: string[];
  confirm?: string[];
}

export interface LoopMemory {
  /** Markdown file, resolved relative to the loop file. */
  file: string;
}

/**
 * Where a loop's `plan` step gets its plan. Omitted = the agent writes the plan.
 * `plan from "<path>"` reads the plan from a file instead (e.g. a hand-written
 * `.md`), so the loop executes a plan you control. `type` leaves room for future
 * sources (a URL, a command) without changing callers.
 */
export interface PlanSource {
  type: "file";
  path: string;
}

export type Predicate =
  // `runs` (from `… passes N times`) re-runs the check N times and requires every run to pass —
  // a flake guard against a green that only holds by luck. Absent / 1 = the usual single run.
  | { type: "test"; target: string; runs?: number }
  | { type: "command"; command: string; expect?: "exit-zero" | "empty"; runs?: number }
  | { type: "human"; description: string }
  /**
   * An eval: a review skill judges the goal (approve / score). `subject` selects what it
   * inspects — the produced `output` (default) or the `trajectory` (the path and tool calls
   * the agent took to get there). `bar` is an optional inline rubric (`the bar:`) naming the
   * conditions the judge scores against. `judges` (from `… by N judges`) runs the eval N times
   * independently and takes a majority vote — consensus smooths single-judge wobble. Absent /
   * 1 = the usual single verdict.
   */
  | { type: "skill"; skill: string; expect: "approve"; minScore?: number; subject?: "output" | "trajectory"; bar?: string; judges?: number };

export interface Transition {
  on: "pass" | "fail" | "blocked" | "attempts";
  requireGoalMet?: boolean;
  threshold?: number;
  do: Action[];
}

export interface Action {
  action: "stop" | "reflect" | "plan" | "act" | "observe" | "ask-human";
  focus?: string;
  warn?: string;
}

export interface Flow {
  kind: "flow";
  name: string;
  steps: FlowStep[];
}

export interface FlowStep {
  /** File path as written, e.g. "test.loop". Resolved relative to the flow file. */
  ref: string;
  /** Step name = ref basename without extension, e.g. "test". Used for handoff + events. */
  name: string;
  /** Per-step blocking human gate ("a human approves first"). */
  gate?: { message: string } | null;
  /** "with the result of <name>" — pull upstream text from a named earlier step. */
  fromStep?: string;
  /** Present when this step iterates: run `ref` once per item enumerated from `source`. */
  forEach?: { var: string; source: string };
}

export class ParseError extends Error {
  constructor(message: string, public line: number) {
    super(`Loop parse error (line ${line}): ${message}`);
    this.name = "ParseError";
  }
}
