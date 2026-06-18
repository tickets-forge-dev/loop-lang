/**
 * Minimal types for the subset of the Archon workflow schema we emit.
 * Confirmed against coleam00/Archon (packages/workflows/src/schemas, default branch).
 * A node is discriminated by which mode key is present (no `type:` field); exactly
 * one of prompt | bash | loop | approval (we don't emit command/script/cancel) must exist.
 */

export interface ArchonWorkflow {
  name: string;
  description: string;
  provider?: string;
  model?: string;
  /** Required true when any approval node is present (it pauses the run). */
  interactive?: boolean;
  nodes: ArchonNode[];
}

export interface ArchonNodeBase {
  id: string;
  depends_on?: string[];
  trigger_rule?: "all_success" | "one_success" | "none_failed_min_one_success" | "all_done";
  when?: string;
  idle_timeout?: number;
}

export interface ArchonPromptNode extends ArchonNodeBase {
  prompt: string;
}

export interface ArchonBashNode extends ArchonNodeBase {
  bash: string;
}

export interface ArchonLoopConfig {
  prompt: string;
  until: string;
  max_iterations: number;
  fresh_context?: boolean;
  until_bash?: string;
  interactive?: boolean;
  gate_message?: string;
}

export interface ArchonLoopNode extends ArchonNodeBase {
  loop: ArchonLoopConfig;
}

export interface ArchonApprovalConfig {
  message: string;
  capture_response?: boolean;
  on_reject?: { prompt: string; max_attempts?: number };
}

export interface ArchonApprovalNode extends ArchonNodeBase {
  approval: ArchonApprovalConfig;
}

export type ArchonNode = ArchonPromptNode | ArchonBashNode | ArchonLoopNode | ArchonApprovalNode;
