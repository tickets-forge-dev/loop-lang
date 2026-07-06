/**
 * Render a parsed loop-spec as a compact ASCII flow — the "see the shape" view.
 * Pure (no IO), so the CLI's `show`/`ls` wrap it and it's unit-testable. The
 * `/loopflow` skill prints this after every create/edit so the user watches the
 * flow evolve.
 */
import type { LoopFile, Definition, Loop, Pipeline, Flow, Predicate, Transition, FlowStep } from "@loop-lang/parser";

function predicateStr(p?: Predicate | null): string | null {
  if (!p) return null;
  // `… passes N times` re-runs the check as a flake guard; surface it compactly as `×N`.
  const times = (p.type === "test" || p.type === "command") && p.runs && p.runs > 1 ? ` ×${p.runs}` : "";
  if (p.type === "test") return `test "${p.target}"${times}`;
  if (p.type === "command") return (p.expect === "empty" ? `"${p.command}" finds nothing` : `"${p.command}" passes`) + times;
  if (p.type === "human") return `a human confirms "${p.description}"`;
  // skill = an eval: name the verdict and, when not the default, the subject it judges.
  const verdict = p.minScore !== undefined ? `scores ${p.minScore}+` : "approves";
  const on = p.subject && p.subject !== "output" ? ` on the ${p.subject}` : "";
  const panel = p.judges && p.judges > 1 ? ` · ${p.judges} judges` : "";
  return `eval: skill "${p.skill}" ${verdict}${on}${panel}`;
}
/** Render every `done when` predicate (a conjunction) as labelled strings. */
function predicateStrs(dw?: Predicate[] | null): string[] {
  return (dw ?? []).map(predicateStr).filter((s): s is string => s != null);
}
const failsToReflect = (t?: Transition[]) =>
  (t ?? []).some((x) => x.on === "fail" && (x.do ?? []).some((d) => d.action === "reflect" || d.action === "plan"));
function guard(t?: Transition[]): { n?: number; warn?: string } | null {
  const a = (t ?? []).find((x) => x.on === "attempts");
  if (!a) return null;
  return { n: a.threshold, warn: (a.do ?? []).find((d) => d.warn)?.warn };
}
const asksWhenBlocked = (t?: Transition[]) =>
  (t ?? []).some((x) => x.on === "blocked" && (x.do ?? []).some((d) => d.action === "ask-human"));

function skillPolicyStr(loop: Loop): string | null {
  const policy = loop.skillPolicy;
  if (!policy) return loop.skills?.length ? `fixed + ${loop.skills.join(", ")}` : null;
  const use = policy.use?.length ? ` + ${policy.use.join(", ")}` : "";
  return `${policy.mode}${use}`;
}

export function renderLoop(loop: Loop): string {
  const L: string[] = [`loop ${loop.name ? `"${loop.name}"` : "(unnamed)"}`];
  const cyc = (loop.cycle?.length ? loop.cycle : ["plan", "act", "observe"]).join(" → ");
  L.push(`   ↻  ${cyc}            (each cycle)`);
  if (failsToReflect(loop.transitions)) L.push(`   ↺  on fail: reflect → plan      (the back-edge)`);
  const preds = predicateStrs(loop.doneWhen);
  if (preds.length) preds.forEach((p) => L.push(`   ✓  done when: ${p}`));
  else L.push(`   ⚠  no done-when — can only stop via a human path or the guard`);
  const g = guard(loop.transitions);
  if (g) L.push(`   ⛔ guard: after ${g.n ?? "N"} tries → stop${g.warn ? ` & warn "${g.warn}"` : ""}`);
  if (loop.humanPlan) L.push(`   👤 a human approves the plan first`);
  if (loop.humanReviewBeforeStop) L.push(`   👤 a human reviews before stopping`);
  if (asksWhenBlocked(loop.transitions)) L.push(`   👤 when blocked: ask a human`);
  for (const h of loop.hooks ?? []) {
    const what = h.predicate.type === "command" ? `"${h.predicate.command}" ${h.predicate.expect === "empty" ? "finds nothing" : "passes"}` : h.predicate.type === "test" ? `test "${h.predicate.target}"` : "";
    L.push(`   ⊘  hook ${h.at.replace(/-/g, " ")}: ${what}`);
  }
  const sp = skillPolicyStr(loop);
  if (sp) L.push(`   🧰 skills: ${sp}`);
  if (loop.context?.knowledge?.length) L.push(`   📖 knowledge: ${loop.context.knowledge.join(", ")}`);
  if (loop.context?.examples?.length) L.push(`   ✎  examples: ${loop.context.examples.join(", ")}`);
  if (loop.tools?.length) L.push(`   🔌 tools from: ${loop.tools.join(", ")}`);
  if (loop.also?.length) L.push(`   +  also: ${loop.also.join(", ")}`);
  if (loop.goal) L.push(`   ·  goal: ${loop.goal}`);
  return L.join("\n");
}

function gateMark(loop: Loop): string {
  if (loop.humanPlan) return " 👤 plan";
  if (loop.humanReviewBeforeStop) return " 👤 review";
  return "";
}
export function renderPipeline(p: Pipeline): string {
  const L = [`pipeline "${p.name}"   (stages in order · fail-fast)`];
  p.stages.forEach((s, i) => {
    const preds = predicateStrs(s.loop.doneWhen);
    const pred = preds.length ? `${preds[0]}${preds.length > 1 ? ` (+${preds.length - 1})` : ""}` : null;
    const par = s.parallelGroup != null ? "⇉ " : "";
    const tail = [s.gate ? "👤 gate" : null, pred ? `✓ ${pred}` : null].filter(Boolean).join(" · ");
    L.push(`   ${i + 1}. ${par}${s.name}${gateMark(s.loop)}${tail ? `   ${tail}` : ""}`);
  });
  return L.join("\n");
}

function stepStr(s: FlowStep): string {
  if (s.forEach) return `for each ${s.forEach.var} in "${s.forEach.source}" → ${s.ref}`;
  return s.ref + (s.gate ? " 👤" : "") + (s.fromStep ? ` (uses ${s.fromStep})` : "");
}
export function renderFlow(f: Flow): string {
  return [`flow "${f.name}"`, ...f.steps.map((s, i) => `   ${i === 0 ? "  " : "→ "}${stepStr(s)}`)].join("\n");
}

export function renderDef(d: Definition): string {
  if (d.kind === "pipeline") return renderPipeline(d);
  if (d.kind === "flow") return renderFlow(d);
  return renderLoop(d);
}

export function renderFile(file: LoopFile): string {
  const parts: string[] = [];
  const m = file.config?.models;
  if (m) parts.push(`models: fast=${m.tiers?.fast ?? "default"} · strong=${m.tiers?.strong ?? "default"}`);
  if (file.config?.git) parts.push(`git: ${file.config.git.isolation ?? "branch"}${file.config.git.openPr ? " + PR" : ""}${file.config.git.push ? "" : " · no push to main"}`);
  if (file.config?.cycle?.length) parts.push(`each cycle: ${file.config.cycle.join(" → ")}   (default)`);
  if (file.config?.rigor || file.config?.mode) {
    parts.push([file.config.rigor ? `rigor: ${file.config.rigor}` : null, file.config.mode ? `mode: ${file.config.mode}` : null].filter(Boolean).join(" · "));
  }
  if (file.config?.observe) {
    const o = file.config.observe;
    parts.push(`observe: ${[o.trace ? "trace" : null, o.meter ? "meter" : null, o.costCap ? `cap ${o.costCap}` : null].filter(Boolean).join(" · ")}`);
  }
  if (file.config?.sandbox) {
    const s = file.config.sandbox;
    parts.push(`sandbox: ${[s.network === "none" ? "no network" : s.network === "allowlist" ? `egress ${(s.egress ?? []).join(",")}` : null, s.cpu ? `cpu ${s.cpu}` : null, s.memory ? `mem ${s.memory}` : null, s.time ? `time ${s.time}` : null].filter(Boolean).join(" · ")}`);
  }
  if (file.config?.runsAs) parts.push(`runs as: ${file.config.runsAs}`);
  for (const d of file.definitions) parts.push(renderDef(d));
  return parts.join("\n\n") || "(empty .loop)";
}

/** Terse one-line shape for `loop ls`. */
export function oneLine(d: Definition): string {
  if (d.kind === "pipeline") return `pipeline "${d.name}" · ${d.stages.length} stage${d.stages.length === 1 ? "" : "s"}`;
  if (d.kind === "flow") return `flow "${d.name}" · ${d.steps.length} step${d.steps.length === 1 ? "" : "s"}`;
  const bits = [
    d.cycle?.length ? d.cycle.join("→") : "plan→act→observe",
    failsToReflect(d.transitions) ? "reflect" : null,
    guard(d.transitions) ? "guard" : null,
    d.doneWhen?.length ? "done-when" : "⚠ no done-when",
  ].filter(Boolean);
  return `loop "${d.name ?? "?"}" · ${bits.join(", ")}`;
}

// ---- explain: read a loop back in plain English (the friendly, non-expert view) ----

const CYCLE_PROSE: Record<string, string> = {
  plan: "plans the change",
  act: "makes the change",
  observe: "checks the result",
};

/** Join items into prose: "a", "a then b", "a, b, then c". */
function joinList(items: string[], conj = "then"): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conj} ${items[items.length - 1]}`;
}

function predicateProse(p: Predicate): string {
  const times = (p.type === "test" || p.type === "command") && p.runs && p.runs > 1 ? ` ${p.runs} times in a row` : "";
  if (p.type === "test") return `the test "${p.target}" passes${times}`;
  if (p.type === "command") return (p.expect === "empty" ? `running \`${p.command}\` reports nothing` : `running \`${p.command}\` succeeds`) + times;
  if (p.type === "human") return `you confirm "${p.description}"`;
  // skill = an eval
  const verdict = p.minScore !== undefined ? `the "${p.skill}" review scores ${p.minScore} or more` : `the "${p.skill}" review approves`;
  const panel = p.judges && p.judges > 1 ? ` by a majority of ${p.judges} judges` : "";
  return verdict + panel + (p.subject === "trajectory" ? " (judging how it got there, not just the result)" : "");
}

/** A plain-English description of a single loop. */
export function explainLoop(loop: Loop): string {
  const L: string[] = [];
  L.push(`${loop.name ? `Loop "${loop.name}"` : "This loop"} works toward: ${loop.goal || "(no goal set)"}.`);
  const cyc = (loop.cycle?.length ? loop.cycle : ["plan", "act", "observe"]).map((s) => CYCLE_PROSE[s] ?? s);
  L.push(`Each round it ${joinList(cyc)}.`);
  const preds = loop.doneWhen ?? [];
  if (preds.length) L.push(`It's done when ${joinList(preds.map(predicateProse), "and")}.`);
  else L.push(`It has no automatic check, so it relies on a human to decide when to stop.`);
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
  if (failsToReflect(loop.transitions)) L.push(`If a check fails, it reflects on why and tries again.`);
  if (loop.humanPlan) L.push(`It pauses for you to approve the plan before changing anything.`);
  if (loop.humanReviewBeforeStop) L.push(`It pauses for you to review the result before finishing.`);
  if (asksWhenBlocked(loop.transitions)) L.push(`If it gets stuck, it stops and asks you.`);
  const g = guard(loop.transitions);
  if (g) L.push(`It gives up after ${g.n ?? "a few"} tries${g.warn ? ` (warning "${g.warn}")` : ""}.`);
  if (loop.also?.length) L.push(`Once the goal is met it also: ${loop.also.join(", ")}.`);
  return L.join(" ");
}

export function explainDef(d: Definition): string {
  if (d.kind === "loop") return explainLoop(d);
  if (d.kind === "pipeline") {
    const n = d.stages.length;
    const L = [`Pipeline "${d.name}" runs ${n} ${n === 1 ? "story" : "stories"} in order, stopping if one fails:`];
    d.stages.forEach((s, i) => L.push(`  ${i + 1}. ${s.name}${s.gate ? " (pauses for your OK first)" : ""} — ${explainLoop(s.loop)}`));
    return L.join("\n");
  }
  const L = [`Flow "${d.name}" runs these loop files in sequence, handing each result to the next:`];
  d.steps.forEach((s, i) =>
    L.push(`  ${i + 1}. ${s.forEach ? `for each item in "${s.forEach.source}", run ${s.ref}` : s.ref}${s.gate ? " (pauses for your OK first)" : ""}`)
  );
  return L.join("\n");
}

/** Plain-English description of a whole .loop file — the `loop-run explain` view. */
export function explainFile(file: LoopFile): string {
  return (file.definitions ?? []).map(explainDef).join("\n\n") || "(empty .loop)";
}
