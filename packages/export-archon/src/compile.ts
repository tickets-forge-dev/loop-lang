import type { Loop, LoopFile, Definition, Pipeline, Predicate } from "@loop/parser";
import type { ArchonWorkflow, ArchonNode, ArchonLoopConfig } from "./types.js";

export interface ExportOptions {
  /** Maps a `done when the test "X"` target to a shell command for `until_bash`. */
  testCommand?: (target: string) => string;
  /** max_iterations when a loop has no `after N tries` thrash guard. */
  defaultMaxIterations?: number;
  /** idle_timeout (ms) set on each loop node. */
  idleTimeoutMs?: number;
  /** Override the workflow provider (else derived from config.runner). */
  provider?: string;
  model?: string;
}

/** Completion signal — distinctive token so it can't collide with ordinary prose. */
const SIGNAL = "LOOP_COMPLETE";

function slug(s: string): string {
  let r =
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "loop";
  // Node ids are referenced as $id.output; Archon's id class is [a-zA-Z_][a-zA-Z0-9_-]*,
  // so the id must start with a letter or underscore (a leading digit would not match).
  if (!/^[a-z_]/.test(r)) r = `n-${r}`;
  return r;
}

function hasApproval(nodes: ArchonNode[]): boolean {
  return nodes.some((n) => "approval" in n);
}

function doneWhenBash(dw: Predicate | null | undefined, opts: ExportOptions): string | undefined {
  if (!dw) return undefined;
  if (dw.type === "test") {
    const make = opts.testCommand ?? ((t: string) => `npm test -- ${t}`);
    return make(dw.target);
  }
  if (dw.type === "command") {
    return dw.expect === "empty" ? `test -z "$(${dw.command})"` : dw.command;
  }
  return undefined; // human predicate -> no bash gate
}

function maxIterations(loop: Loop, opts: ExportOptions): number {
  const t = (loop.transitions ?? []).find((x) => x.on === "attempts" && typeof x.threshold === "number");
  return t?.threshold ?? opts.defaultMaxIterations ?? 10;
}

function policyProse(loop: Loop): string[] {
  const out: string[] = [];
  const auto = loop.policy?.auto ?? [];
  const confirm = loop.policy?.confirm ?? [];
  if (auto.includes("edit")) out.push("You may edit source files freely without asking.");
  if (confirm.length) {
    out.push(
      `Do NOT ${confirm.join(" or ")} — those require human confirmation and are handled outside this loop.`
    );
  }
  return out;
}

function synthPrompt(loop: Loop): string {
  const sections: string[] = [];
  sections.push(`GOAL: ${loop.goal}`);

  const files = loop.context?.files ?? [];
  if (files.length) {
    sections.push("RELEVANT FILES (read these first):\n" + files.map((f) => `  - ${f}`).join("\n"));
  }

  const phaseText: Record<string, string> = {
    plan: "PLAN — inspect the relevant files and decide the smallest change toward the goal.",
    act: "ACT — make that change.",
    observe: "OBSERVE — run the checks and read the result.",
  };
  const steps = loop.cycle.map((p, i) => `  ${i + 1}. ${phaseText[p]}`);
  const policy = policyProse(loop);
  sections.push(
    "Work one iteration at a time, in this cycle:\n" + steps.join("\n") + (policy.length ? "\n" + policy.map((p) => "  " + p).join("\n") : "")
  );

  const reflects = (loop.transitions ?? []).some((t) => t.on === "fail" && t.do.some((a) => a.action === "reflect"));
  if (reflects) {
    sections.push(
      "REFLECT ON FAILURE: if the previous attempt did not pass, study the previous output below, diagnose why it failed, replan, then act.\nPrevious iteration output (empty on the first attempt):\n$LOOP_PREV_OUTPUT"
    );
  }

  const hasBlocked = (loop.transitions ?? []).some((t) => t.on === "blocked" && t.do.some((a) => a.action === "ask-human"));
  const completion = ["COMPLETION:", `  - When the goal is met, output: <promise>${SIGNAL}</promise>`];
  if (hasBlocked) {
    // Note: Archon has no distinct "blocked" loop outcome. A blocked agent simply stops
    // making progress; the loop then fails (no completion / max_iterations) and a downstream
    // approval node picks it up. So we do NOT emit a fake BLOCKED completion signal.
    completion.push(
      "  - If you cannot proceed without a human (a disallowed action, or a decision only a person can make), stop making changes and explain why. The run will pause for a human to review."
    );
  }
  sections.push(completion.join("\n"));
  sections.push("User intent: $USER_MESSAGE");
  return sections.join("\n\n");
}

function buildLoopConfig(loop: Loop, opts: ExportOptions): ArchonLoopConfig {
  const cfg: ArchonLoopConfig = {
    prompt: synthPrompt(loop),
    until: SIGNAL,
    max_iterations: maxIterations(loop, opts),
  };
  const bash = doneWhenBash(loop.doneWhen, opts);
  if (bash) cfg.until_bash = bash;
  if (loop.context?.includeLastFailure) cfg.fresh_context = true;
  return cfg;
}

interface CompiledLoop {
  nodes: ArchonNode[];
  terminal: string;
}

/** Compile one Loop `loop` into its Archon nodes; returns the terminal node id for chaining. */
function compileLoop(loop: Loop, idBase: string, upstream: string[], opts: ExportOptions): CompiledLoop {
  const nodes: ArchonNode[] = [];
  let loopDeps = upstream.slice();

  // humanPlan -> plan prompt + approval gate before the loop
  if (loop.humanPlan) {
    const planId = `${idBase}-plan`;
    nodes.push({
      id: planId,
      depends_on: loopDeps.length ? loopDeps : undefined,
      prompt: `Draft a concrete plan to achieve: ${loop.goal}. Output the plan for human review. Do not edit files yet.`,
    });
    const apprId = `${idBase}-plan-approval`;
    nodes.push({ id: apprId, depends_on: [planId], approval: { message: `Review and approve the plan for: ${loop.goal}` } });
    loopDeps = [apprId];
  }

  const loopId = `${idBase}-loop`;
  nodes.push({
    id: loopId,
    depends_on: loopDeps.length ? loopDeps : undefined,
    idle_timeout: opts.idleTimeoutMs,
    loop: buildLoopConfig(loop, opts),
  });

  let terminal = loopId;
  const fanIn = [loopId];

  (loop.also ?? []).forEach((action, i) => {
    const aid = `${idBase}-also-${i + 1}`;
    nodes.push({
      id: aid,
      depends_on: [loopId],
      prompt: `The goal "${loop.goal}" has been met. Finishing pass: ${action}. Do not change the core behavior; do not migrate or push.`,
    });
    fanIn.push(aid);
  });

  if (loop.humanReviewBeforeStop) {
    const rid = `${idBase}-review`;
    nodes.push({ id: rid, depends_on: [loopId], approval: { message: `Loop reports done for: ${loop.goal}. Approve to finish.` } });
    fanIn.push(rid);
    terminal = rid;
  }

  // on:blocked do:ask-human. Archon strips the completion signal from a loop's stored
  // output and a failed loop's output is empty, so we gate on emptiness (== loop did not
  // complete: blocked or out of attempts), NOT on comparing output to the signal.
  const hasBlocked = (loop.transitions ?? []).some((t) => t.on === "blocked" && t.do.some((a) => a.action === "ask-human"));
  if (hasBlocked) {
    const fid = `${idBase}-failure`;
    nodes.push({
      id: fid,
      depends_on: [loopId],
      trigger_rule: "all_done",
      when: `$${loopId}.output == ''`,
      approval: {
        message: `The "${loop.goal}" loop did not complete — the agent is blocked or ran out of attempts. Review and advise, or reject to stop.`,
      },
    });
    fanIn.push(fid);
  }

  const warn = (loop.transitions ?? []).find((t) => t.on === "attempts" && t.do.some((a) => a.action === "stop" && a.warn));
  if (fanIn.length > 1 || warn) {
    const jid = `${idBase}-report`;
    const warnText = warn
      ? `\n\nWARN: if the loop hit its ${maxIterations(loop, opts)}-attempt limit without meeting the goal, state clearly that it did NOT land and needs human follow-up.`
      : "";
    nodes.push({
      id: jid,
      depends_on: fanIn,
      trigger_rule: "all_done",
      prompt: `Summarize the run for: ${loop.goal}.\nLoop result: $${loopId}.output${warnText}`,
    });
    terminal = jid;
  }

  return { nodes, terminal };
}

function providerFor(file: LoopFile, opts: ExportOptions): string | undefined {
  if (opts.provider) return opts.provider;
  const r = file.config?.runner;
  if (!r) return undefined;
  return r === "claude-code" ? "claude" : r;
}

function compilePipeline(pipeline: Pipeline, file: LoopFile, opts: ExportOptions): ArchonWorkflow {
  const nodes: ArchonNode[] = [];
  let prevTerminal: string | null = null;

  for (const stage of pipeline.stages) {
    const idBase = slug(stage.name);
    let deps = prevTerminal ? [prevTerminal] : [];
    if (stage.gate) {
      const gateId = `${idBase}-gate`;
      nodes.push({
        id: gateId,
        depends_on: deps.length ? deps : undefined,
        approval: { message: stage.gate.message },
      });
      deps = [gateId];
    }
    const compiled = compileLoop(stage.loop, idBase, deps, opts);
    nodes.push(...compiled.nodes);
    prevTerminal = compiled.terminal;
  }

  return {
    name: slug(pipeline.name),
    description: `${pipeline.name} — compiled from a Loop pipeline by @loop/export-archon.`,
    provider: providerFor(file, opts),
    model: opts.model,
    interactive: hasApproval(nodes) ? true : undefined,
    nodes,
  };
}

function compileBareLoop(loop: Loop, file: LoopFile, opts: ExportOptions): ArchonWorkflow {
  const idBase = slug(loop.name ?? "loop");
  const { nodes } = compileLoop(loop, idBase, [], opts);
  return {
    name: idBase,
    description: `${loop.goal}\n\nCompiled from a Loop definition by @loop/export-archon.`,
    provider: providerFor(file, opts),
    model: opts.model,
    interactive: hasApproval(nodes) ? true : undefined,
    nodes,
  };
}

/** Compile one Loop definition to one Archon workflow object. */
export function compileDefinition(def: Definition, file: LoopFile, opts: ExportOptions = {}): ArchonWorkflow {
  if (def.kind === "pipeline") return compilePipeline(def, file, opts);
  if (def.kind === "flow") throw new Error(`Archon export does not support flow definitions — export each referenced loop file individually.`);
  return compileBareLoop(def, file, opts);
}

/** Compile every definition in a parsed Loop file to Archon workflows. */
export function compileFile(file: LoopFile, opts: ExportOptions = {}): ArchonWorkflow[] {
  return file.definitions.map((d) => compileDefinition(d, file, opts));
}
