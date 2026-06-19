import type { Loop, Predicate } from "@loop/parser";

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
  | { type: "foreach-end"; var: string; satisfied: boolean };

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
}

export interface ActInput {
  goal: string;
  plan: string;
  allowedClasses: string[];
  baseDir: string;
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

export interface ArchonFetchInput {
  goal: string;
  project?: string;
  reflection: string | null;
  baseDir: string;
}

/**
 * A plan/task source backed by Archon (https://github.com/coleam00/Archon).
 * When a loop declares `plan from archon`, the plan step pulls the next task/plan
 * from an Archon project instead of having the agent generate one; `complete` writes
 * status back so Archon and Loop stay in sync.
 */
export interface ArchonPlanSource {
  fetchPlan(input: ArchonFetchInput): Promise<string>;
  complete?(input: { project?: string; goal: string; satisfied: boolean }): Promise<void>;
}

export interface RunOptions {
  runner: Runner;
  verifier: Verifier;
  human: HumanIO;
  baseDir: string;
  /** Required only when a loop declares `plan from archon`. */
  archon?: ArchonPlanSource;
  onEvent?: (e: LoopEvent) => void;
  /** Absolute safety cap on cycle iterations per loop, regardless of transitions. */
  hardCap?: number;
  /** Loads + parses a referenced .loop file. Required only when a `flow` runs. */
  loadFile?(path: string, baseDir: string): Promise<import("@loop/parser").LoopFile>;
  /** Reads the raw text of a `for each` source data file. Required only when a flow uses `for each`. */
  readText?(path: string, baseDir: string): Promise<string>;
  /** Upstream handoff text injected into each plan step (set by executeFlow). */
  upstream?: string;
  /** Resolved file paths currently executing — for flow cycle detection. */
  flowStack?: string[];
}

export interface LoopOutcome {
  satisfied: boolean;
  reason: StopReason;
  attempts: number;
  /** Last observe output / reflection — used as the flow handoff text. */
  summary?: string;
}

export type { Loop };
