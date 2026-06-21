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

export type ModelTier = "fast" | "strong";
export type ModelPhase = "plan" | "act" | "reflect" | "also";
export interface ModelPolicy {
  tiers?: { fast?: string; strong?: string };
  phases?: Partial<Record<ModelPhase, ModelTier>>;
}

export interface Config {
  use?: string;
  useOverrides?: OverrideEntry[];
  runner?: string;
  schedule?: string;
  target?: string;
  notify?: string;
  git?: GitPolicy;
  models?: ModelPolicy;
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
}

export interface Loop {
  kind: "loop";
  name: string | null;
  goal: string;
  doneWhen?: Predicate | null;
  context?: LoopContext;
  policy?: Policy;
  cycle: CycleStep[];
  /** Extra finishing passes run after the goal is met (e.g. "polish", "run a security check"). */
  also?: string[];
  planSource?: PlanSource;
  humanPlan?: boolean;
  humanReviewBeforeStop?: boolean;
  transitions?: Transition[];
  git?: GitPolicy;
  models?: ModelPolicy;
}

export type CycleStep = "plan" | "act" | "observe";

export interface LoopContext {
  files?: string[];
  docs?: string[];
  includeLastFailure?: boolean;
}

export interface Policy {
  auto?: string[];
  confirm?: string[];
}

export interface PlanSource {
  type: "agent" | "archon";
  project?: string;
}

export type Predicate =
  | { type: "test"; target: string }
  | { type: "command"; command: string; expect?: "exit-zero" | "empty" }
  | { type: "human"; description: string };

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
