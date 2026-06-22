/**
 * Render a parsed loop-spec as a compact ASCII flow — the "see the shape" view.
 * Pure (no IO), so the CLI's `show`/`ls` wrap it and it's unit-testable. The
 * `/loopflow` skill prints this after every create/edit so the user watches the
 * flow evolve.
 */
import type { LoopFile, Definition, Loop, Pipeline, Flow, Predicate, Transition, FlowStep } from "@loop-lang/parser";

function predicateStr(p?: Predicate | null): string | null {
  if (!p) return null;
  if (p.type === "test") return `test "${p.target}"`;
  if (p.type === "command") return p.expect === "empty" ? `"${p.command}" finds nothing` : `"${p.command}" passes`;
  if (p.type === "human") return `a human confirms "${p.description}"`;
  return null;
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

export function renderLoop(loop: Loop): string {
  const L: string[] = [`loop ${loop.name ? `"${loop.name}"` : "(unnamed)"}`];
  const cyc = (loop.cycle?.length ? loop.cycle : ["plan", "act", "observe"]).join(" → ");
  L.push(`   ↻  ${cyc}            (each cycle)`);
  if (failsToReflect(loop.transitions)) L.push(`   ↺  on fail: reflect → plan      (the back-edge)`);
  const pred = predicateStr(loop.doneWhen);
  L.push(pred ? `   ✓  done when: ${pred}` : `   ⚠  no done-when — can only stop via a human path or the guard`);
  const g = guard(loop.transitions);
  if (g) L.push(`   ⛔ guard: after ${g.n ?? "N"} tries → stop${g.warn ? ` & warn "${g.warn}"` : ""}`);
  if (loop.humanPlan) L.push(`   👤 a human approves the plan first`);
  if (loop.humanReviewBeforeStop) L.push(`   👤 a human reviews before stopping`);
  if (asksWhenBlocked(loop.transitions)) L.push(`   👤 when blocked: ask a human`);
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
    const pred = predicateStr(s.loop.doneWhen);
    const tail = [s.gate ? "👤 gate" : null, pred ? `✓ ${pred}` : null].filter(Boolean).join(" · ");
    L.push(`   ${i + 1}. ${s.name}${gateMark(s.loop)}${tail ? `   ${tail}` : ""}`);
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
    predicateStr(d.doneWhen) ? "done-when" : "⚠ no done-when",
  ].filter(Boolean);
  return `loop "${d.name ?? "?"}" · ${bits.join(", ")}`;
}
