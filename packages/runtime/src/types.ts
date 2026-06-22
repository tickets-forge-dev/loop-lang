import type { Loop, Predicate } from "@loop-lang/parser";

/** A single event in the live trace emitted as a loop runs. */
export type LoopEvent =
  | { type: "pipeline-start"; name: string }
  | { type: "stage-start"; name: string }
  | { type: "stage-end"; name: string; satisfied: boolean }
  | { type: "pipeline-end"; name: string; satisfied: boolean }
  | { type: "loop-start"; name: string | null }
  | { type: "node-enter"; node: CycleNode; attempt: number }
  | { type: "node-exit"; node: CycleNode; attempt: number; ok: boolean; detail?: string }
  | { type: "observe"; passed: boolean; output: string }
  | { type: "transition"; on: string; actions: string[] }
  | { type: "reflect"; focus?: string; text: string }
  | { type: "loop-back"; to: string }
  | { type: "also"; action: string; ok: boolean; detail?: string }
  | { type: "human"; kind: "plan" | "review" | "gate" | "confirm" | "ask"; prompt: string; answer?: string }
  | { type: "stop"; reason: StopReason; warn?: string }
  | { type: "loop-end"; name: string | null; satisfied: boolean }
  | { type: "flow-start"; name: string }
  | { type: "flow-step-start"; name: string; ref: string }
  | { type: "flow-step-end"; name: string; satisfied: boolean }
  | { type: "flow-end"; name: string; satisfied: boolean }
  | { type: "foreach-start"; var: string; source: string; count: number }
  | { type: "foreach-item-start"; var: string; index: number; total: number }
  | { type: "foreach-item-end"; var: string; index: number; satisfied: boolean }
  | { type: "foreach-end"; var: string; satisfied: boolean }
  | { type: "git"; action: "branch"|"worktree"|"commit"|"push"|"pr"; detail: string }
  | { type: "model"; node: "plan" | "act" | "reflect" | "also"; tier: "fast" | "strong"; model?: string };

export type CycleNode = "plan" | "act" | "observe";

export type StopReason = "done" | "thrash" | "review-rejected" | "hard-cap" | "human-approved" | "blocked";

export interface PlanInput {
  goal: string;
  files: string[];
  includeLastFailure: boolean;
  reflection: string | null;
  /** Text summary handed from the previous step of a flow (set by executeFlow). */
  upstream?: string;
  baseDir: string;
  /** Model alias/id for this call; set by the engine from the model policy. */
  model?: string;
}

export interface ActInput {
  goal: string;
  plan: string;
  allowedClasses: string[];
  baseDir: string;
  /** Model alias/id for this call; set by the engine from the model policy. */
  model?: string;
}

export interface ActResult {
  summary: string;
  blocked?: boolean;
}

export interface ReflectInput {
  goal: string;
  focus?: string;
  output: string;
  baseDir: string;
  /** Model alias/id for this call; set by the engine from the model policy. */
  model?: string;
}

/** Executes the agent-driven nodes. The real one drives Claude Code; the mock is for tests. */
export interface Runner {
  plan(input: PlanInput): Promise<string>;
  act(input: ActInput): Promise<ActResult>;
  reflect(input: ReflectInput): Promise<string>;
}

export interface VerifyResult {
  passed: boolean;
  output: string;
}

/** Evaluates a `done when` predicate. */
export interface Verifier {
  verify(predicate: Predicate | null | undefined, baseDir: string): Promise<VerifyResult>;
}

/** Human-in-the-loop boundary. Return true to approve / proceed. */
export interface HumanIO {
  /** Approve or edit the plan before acting. */
  plan(goal: string, plan: string): Promise<boolean>;
  /** Judge the output before the loop may stop. */
  review(goal: string): Promise<boolean>;
  /** A hard blocking gate (e.g. before deploy). */
  gate(message: string): Promise<boolean>;
  /** Confirm granting a confirm-class action this run. */
  confirm(actionClass: string): Promise<boolean>;
  /** Unblock when the agent reports it is stuck. */
  ask(prompt: string): Promise<void>;
}

export interface RunOptions {
  runner: Runner;
  verifier: Verifier;
  human: HumanIO;
  baseDir: string;
  onEvent?: (e: LoopEvent) => void;
  /** Absolute safety cap on cycle iterations per loop, regardless of transitions. */
  hardCap?: number;
  /** Loads + parses a referenced .loop file. Required only when a `flow` runs. */
  loadFile?(path: string, baseDir: string): Promise<import("@loop-lang/parser").LoopFile>;
  /** Reads the raw text of a `for each` source data file. Required only when a flow uses `for each`. */
  readText?(path: string, baseDir: string): Promise<string>;
  /** Upstream handoff text injected into each plan step (set by executeFlow). */
  upstream?: string;
  /** Resolved file paths currently executing — for flow cycle detection. */
  flowStack?: string[];
  /** GitIO implementation for performing branch/commit/push/PR operations. */
  git?: import("./git.js").GitIO;
  /** File-level git policy resolved from config.git (passed through run opts). */
  gitPolicy?: import("@loop-lang/parser").GitPolicy;
  /** The active branch name after git start (set by run() for inner calls). */
  gitBranch?: string;
  /** True once git has been started (prevents re-initialising in nested calls). */
  gitStarted?: boolean;
  /** File-level model policy resolved from config.models. */
  modelPolicy?: import("@loop-lang/parser").ModelPolicy;
  /** CLI/extension --model — kill switch that forces all phases to one model. */
  cliModel?: string;
}

export interface LoopOutcome {
  satisfied: boolean;
  reason: StopReason;
  attempts: number;
  /** Last observe output / reflection — used as the flow handoff text. */
  summary?: string;
}

export type { Loop };
