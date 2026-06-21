import { resolve, dirname, basename } from "node:path";
import type { Loop, Pipeline, Flow, FlowStep, Definition, Transition, Action, LoopFile } from "@loop/parser";
import type { CycleNode, LoopEvent, LoopOutcome, RunOptions, StopReason } from "./types.js";
import { enumerateItems } from "./iterate.js";
import { resolveGit, isProtected } from "./git.js";
import { resolveModels, modelForPhase } from "./models.js";

const DEFAULT_HARD_CAP = 25;

/** Action-class mapping for policy gating: a cycle's `act` may need confirm-class grants. */
function emit(opts: RunOptions, e: LoopEvent) {
  opts.onEvent?.(e);
}

const slug = (s: string | null | undefined) =>
  (s ?? "loop").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "loop";

async function gitCommit(opts: RunOptions, message: string): Promise<void> {
  if (!opts.git) return;
  await opts.git.commit({ message, dir: opts.baseDir });
  emit(opts, { type: "git", action: "commit", detail: message });
}

/**
 * Transition precedence is independent of source order, so a thrash guard
 * (`after N tries`) wins over a `when it fails` rule once the threshold is hit.
 * Order: blocked > attempts > pass > fail.
 */
function pickTransition(
  transitions: Transition[] | undefined,
  ctx: { blocked: boolean; attempts: number; passed: boolean; goalMet: boolean }
): Transition | null {
  if (!transitions || transitions.length === 0) return null;
  const byOn = (on: Transition["on"]) => transitions.filter((t) => t.on === on);

  if (ctx.blocked) {
    const t = byOn("blocked")[0];
    if (t) return t;
  }
  for (const t of byOn("attempts")) {
    if (typeof t.threshold === "number" && ctx.attempts > t.threshold) return t;
  }
  if (ctx.passed) {
    for (const t of byOn("pass")) {
      if (!t.requireGoalMet || ctx.goalMet) return t;
    }
  }
  if (!ctx.passed) {
    const t = byOn("fail")[0];
    if (t) return t;
  }
  return null;
}

async function executeLoop(loop: Loop, opts: RunOptions): Promise<LoopOutcome> {
  const hardCap = opts.hardCap ?? DEFAULT_HARD_CAP;
  emit(opts, { type: "loop-start", name: loop.name });
  const eff = resolveModels(opts.modelPolicy, loop.models);
  const pick = (phase: "plan" | "act" | "reflect" | "also") => modelForPhase(eff, phase, opts.cliModel);

  const files = loop.context?.files ?? [];
  const includeLastFailure = loop.context?.includeLastFailure ?? false;
  const autoClasses = loop.policy?.auto ?? [];
  const confirmClasses = loop.policy?.confirm ?? [];

  let reflection: string | null = null;
  let lastPlan = "";
  let lastOutput = "";
  let attempts = 0;
  // Confirm-class grants are asked once and remembered for the loop's lifetime.
  const grantedConfirm = new Set<string>();
  let confirmAsked = false;

  // "a human approves the plan first" — gate at the very start.
  let humanPlanApproved = false;

  // A `plan from archon` loop fetches its plan even when the author omits `plan`
  // from the cycle (the plan comes from Archon, the cycle just executes it).
  const cycleSteps: CycleNode[] =
    loop.planSource?.type === "archon" && !loop.cycle.includes("plan")
      ? ["plan", ...(loop.cycle as CycleNode[])]
      : (loop.cycle as CycleNode[]);

  const finish = (satisfied: boolean, reason: StopReason, warn?: string): LoopOutcome => {
    emit(opts, { type: "stop", reason, ...(warn ? { warn } : {}) });
    emit(opts, { type: "loop-end", name: loop.name, satisfied });
    return { satisfied, reason, attempts, summary: lastOutput };
  };

  while (true) {
    attempts++;
    if (attempts > hardCap) {
      return finish(false, "hard-cap");
    }

    let blocked = false;
    let passed = false;
    let observeOutput = "";
    let observed = false;

    for (const step of cycleSteps) {
      emit(opts, { type: "node-enter", node: step, attempt: attempts });

      if (step === "plan") {
        if (loop.planSource?.type === "archon") {
          if (!opts.archon) throw new Error(`loop "${loop.name ?? ""}" uses "plan from archon" but no Archon plan source was provided`);
          lastPlan = await opts.archon.fetchPlan({
            goal: loop.goal,
            project: loop.planSource.project,
            reflection,
            baseDir: opts.baseDir,
          });
        } else {
          emit(opts, { type: "model", node: "plan", tier: eff.phases.plan, model: pick("plan") });
          lastPlan = await opts.runner.plan({
            goal: loop.goal,
            files,
            includeLastFailure,
            reflection,
            upstream: opts.upstream,
            baseDir: opts.baseDir,
            model: pick("plan"),
          });
        }
        reflection = null; // consumed by this plan
        if (loop.humanPlan && !humanPlanApproved) {
          emit(opts, { type: "human", kind: "plan", prompt: loop.goal });
          const ok = await opts.human.plan(loop.goal, lastPlan);
          humanPlanApproved = ok;
          if (!ok) {
            emit(opts, { type: "node-exit", node: step, attempt: attempts, ok: false, detail: "plan rejected" });
            // human rejected the plan: reflect and replan next iteration
            reflection = "The human rejected the plan; revise it.";
            emit(opts, { type: "loop-back", to: "plan" });
            blocked = true;
            break;
          }
        }
        emit(opts, { type: "node-exit", node: step, attempt: attempts, ok: true });
      } else if (step === "act") {
        if (confirmClasses.length > 0 && !confirmAsked) {
          confirmAsked = true;
          for (const cls of confirmClasses) {
            emit(opts, { type: "human", kind: "confirm", prompt: cls });
            const ok = await opts.human.confirm(cls);
            if (ok) grantedConfirm.add(cls);
          }
        }
        const allowedClasses = [...autoClasses, ...grantedConfirm];
        emit(opts, { type: "model", node: "act", tier: eff.phases.act, model: pick("act") });
        const res = await opts.runner.act({
          goal: loop.goal,
          plan: lastPlan,
          allowedClasses,
          baseDir: opts.baseDir,
          model: pick("act"),
        });
        if (res.blocked) blocked = true;
        emit(opts, { type: "node-exit", node: step, attempt: attempts, ok: !res.blocked, detail: res.summary });
      } else {
        // observe
        const v = await opts.verifier.verify(loop.doneWhen, opts.baseDir);
        observed = true;
        passed = v.passed;
        observeOutput = v.output;
        lastOutput = v.output;
        emit(opts, { type: "observe", passed: v.passed, output: v.output });
        emit(opts, { type: "node-exit", node: step, attempt: attempts, ok: v.passed });
      }
    }

    if (opts.git && resolveGit(opts.gitPolicy, loop.git).commit === "cycle") {
      await gitCommit(opts, `loop: ${loop.name ?? "cycle"} — cycle ${attempts}`);
    }

    const goalMet = loop.doneWhen ? passed : false;

    const t = pickTransition(loop.transitions, { blocked, attempts, passed: observed && passed, goalMet });

    if (t) {
      emit(opts, { type: "transition", on: t.on, actions: t.do.map((a) => a.action) });
      const stop = await applyActions(t.do, loop, opts, {
        goalMet,
        output: observeOutput,
        setReflection: (r) => (reflection = r),
      });
      if (stop) return stop;
      continue; // re-enter the cycle (the back-edge)
    }

    // No transition fired — default stopping logic.
    if (goalMet) return finish(true, "done");
    if (loop.humanReviewBeforeStop) {
      emit(opts, { type: "human", kind: "review", prompt: loop.goal });
      const ok = await opts.human.review(loop.goal);
      if (ok) return finish(true, "human-approved");
      // rejected: keep iterating
      continue;
    }
    if (!loop.doneWhen && loop.humanPlan && humanPlanApproved) {
      // plan-only human loop: one approved pass is the deliverable.
      return finish(true, "human-approved");
    }
    if (blocked) {
      // nothing handled the block and there is no review path
      return finish(false, "blocked");
    }
    // otherwise keep going until the hard cap
  }
}

async function applyActions(
  actions: Action[],
  loop: Loop,
  opts: RunOptions,
  ctx: { goalMet: boolean; output: string; setReflection: (r: string) => void }
): Promise<LoopOutcome | null> {
  for (const a of actions) {
    switch (a.action) {
      case "stop": {
        if (loop.humanReviewBeforeStop) {
          emit(opts, { type: "human", kind: "review", prompt: loop.goal });
          const ok = await opts.human.review(loop.goal);
          if (!ok) return null; // veto the stop; keep looping
        }
        const satisfied = ctx.goalMet || !a.warn;
        const reason: StopReason = a.warn ? "thrash" : ctx.goalMet ? "done" : "human-approved";
        emit(opts, { type: "stop", reason, ...(a.warn ? { warn: a.warn } : {}) });
        emit(opts, { type: "loop-end", name: loop.name, satisfied });
        return { satisfied, reason, attempts: -1, summary: ctx.output };
      }
      case "reflect": {
        const rEff = resolveModels(opts.modelPolicy, loop.models);
        emit(opts, { type: "model", node: "reflect", tier: rEff.phases.reflect, model: modelForPhase(rEff, "reflect", opts.cliModel) });
        const text = await opts.runner.reflect({
          goal: loop.goal,
          focus: a.focus,
          output: ctx.output,
          baseDir: opts.baseDir,
          model: modelForPhase(rEff, "reflect", opts.cliModel),
        });
        emit(opts, { type: "reflect", focus: a.focus, text });
        ctx.setReflection(text);
        break;
      }
      case "plan":
      case "act":
      case "observe":
        emit(opts, { type: "loop-back", to: a.action });
        break;
      case "ask-human":
        emit(opts, { type: "human", kind: "ask", prompt: loop.goal });
        await opts.human.ask(loop.goal);
        break;
    }
  }
  return null;
}

async function executePipeline(pipeline: Pipeline, opts: RunOptions): Promise<LoopOutcome> {
  emit(opts, { type: "pipeline-start", name: pipeline.name });
  let lastAttempts = 0;
  for (const stage of pipeline.stages) {
    emit(opts, { type: "stage-start", name: stage.name });
    if (stage.gate) {
      emit(opts, { type: "human", kind: "gate", prompt: stage.gate.message });
      const ok = await opts.human.gate(stage.gate.message);
      if (!ok) {
        emit(opts, { type: "stage-end", name: stage.name, satisfied: false });
        emit(opts, { type: "pipeline-end", name: pipeline.name, satisfied: false });
        return { satisfied: false, reason: "blocked", attempts: lastAttempts };
      }
    }
    const outcome = await executeLoopFull(stage.loop, opts);
    await writeBackArchon(stage.loop, opts, outcome.satisfied);
    lastAttempts = outcome.attempts;
    emit(opts, { type: "stage-end", name: stage.name, satisfied: outcome.satisfied });
    if (!outcome.satisfied) {
      // A failing stage halts the rest of the pipeline.
      emit(opts, { type: "pipeline-end", name: pipeline.name, satisfied: false });
      return { satisfied: false, reason: outcome.reason, attempts: lastAttempts };
    }
    if (opts.git && resolveGit(opts.gitPolicy).commit === "story") {
      await gitCommit(opts, `loop: story "${stage.name}" satisfied`);
    }
  }
  emit(opts, { type: "pipeline-end", name: pipeline.name, satisfied: true });
  return { satisfied: true, reason: "done", attempts: lastAttempts };
}

async function executeForEach(step: FlowStep, opts: RunOptions, stack: string[]): Promise<LoopOutcome> {
  const varName = step.forEach!.var;
  const source = step.forEach!.source;
  if (!opts.readText) throw new Error(`flow runs 'for each ${varName}' but no text reader (readText) was provided`);
  if (!opts.loadFile) throw new Error(`flow runs 'for each ${varName}' but no file loader was provided`);

  const text = await opts.readText(source, opts.baseDir);
  const fmt = /\.md$/i.test(source) ? "md" : "yaml";
  const items = enumerateItems(text, fmt);
  emit(opts, { type: "foreach-start", var: varName, source, count: items.length });

  const templatePath = resolve(opts.baseDir, step.ref);
  if (stack.includes(templatePath)) {
    throw new Error(`flow cycle: ${[...stack, templatePath].map((p) => basename(p)).join(" -> ")}`);
  }

  let failedAccepted = 0;
  for (let i = 0; i < items.length; i++) {
    emit(opts, { type: "foreach-item-start", var: varName, index: i, total: items.length });
    const tmpl = await opts.loadFile(step.ref, opts.baseDir);
    const outcomes = await run(tmpl, {
      ...opts,
      baseDir: dirname(templatePath),
      flowStack: [...stack, templatePath],
      upstream: items[i],
    });
    const ok = outcomes.every((o) => o.satisfied);
    emit(opts, { type: "foreach-item-end", var: varName, index: i, satisfied: ok });
    if (ok) continue;

    // halt-but-human-decides: on a failed item, ask whether to keep going.
    const prompt = `${varName} ${i + 1}/${items.length} failed — continue to the next?`;
    emit(opts, { type: "human", kind: "gate", prompt });
    const cont = await opts.human.gate(prompt);
    if (!cont) {
      emit(opts, { type: "foreach-end", var: varName, satisfied: false });
      return { satisfied: false, reason: "blocked", attempts: 0, summary: `[${varName}] stopped at ${i + 1}/${items.length} (failed)` };
    }
    failedAccepted++; // human chose to proceed past this failure
  }

  emit(opts, { type: "foreach-end", var: varName, satisfied: true });
  const note = failedAccepted ? `, ${failedAccepted} failed but accepted` : "";
  return { satisfied: true, reason: "done", attempts: 0, summary: `[${varName}] ${items.length} item(s)${note}` };
}

async function executeFlow(flow: Flow, opts: RunOptions): Promise<LoopOutcome> {
  emit(opts, { type: "flow-start", name: flow.name });
  const stack = opts.flowStack ?? [];
  const summaries: Record<string, string> = {};
  let carried = opts.upstream; // upstream from a parent flow, if any

  for (const step of flow.steps) {
    emit(opts, { type: "flow-step-start", name: step.name, ref: step.ref });

    if (step.gate) {
      emit(opts, { type: "human", kind: "gate", prompt: step.gate.message });
      const ok = await opts.human.gate(step.gate.message);
      if (!ok) {
        emit(opts, { type: "flow-step-end", name: step.name, satisfied: false });
        emit(opts, { type: "flow-end", name: flow.name, satisfied: false });
        return { satisfied: false, reason: "blocked", attempts: 0 };
      }
    }

    let satisfied: boolean;
    let summary: string;

    if (step.forEach) {
      const r = await executeForEach(step, opts, stack);
      satisfied = r.satisfied;
      summary = r.summary ?? `[${step.name}] ${satisfied ? "done" : "FAILED"}`;
    } else {
      const stepPath = resolve(opts.baseDir, step.ref);
      if (stack.includes(stepPath)) {
        const chain = [...stack, stepPath].map((p) => basename(p)).join(" -> ");
        throw new Error(`flow cycle: ${chain}`);
      }
      if (!opts.loadFile) {
        throw new Error(`flow "${flow.name}" runs "${step.ref}" but no file loader was provided`);
      }

      const subFile = await opts.loadFile(step.ref, opts.baseDir);
      const stepUpstream = step.fromStep ? summaries[step.fromStep] : carried;
      const outcomes = await run(subFile, {
        ...opts,
        baseDir: dirname(stepPath),
        flowStack: [...stack, stepPath],
        upstream: stepUpstream,
      });

      const ok = outcomes.every((o) => o.satisfied);
      const detail = outcomes.map((o) => o.summary).filter(Boolean).map((s) => "\n" + s).join("");
      satisfied = ok;
      summary = `[${step.name}] ${satisfied ? "satisfied" : "FAILED"}${detail}`;
    }

    summaries[step.name] = summary;
    carried = summary;

    emit(opts, { type: "flow-step-end", name: step.name, satisfied });
    if (!satisfied) {
      emit(opts, { type: "flow-end", name: flow.name, satisfied: false });
      return { satisfied: false, reason: "blocked", attempts: 0, summary };
    }
    if (opts.git && resolveGit(opts.gitPolicy).commit === "story") {
      await gitCommit(opts, `loop: story "${step.name}" satisfied`);
    }
  }

  emit(opts, { type: "flow-end", name: flow.name, satisfied: true });
  return { satisfied: true, reason: "done", attempts: 0, summary: carried };
}

/** Run the loop's `also:` finishing passes once its goal is met. */
async function runExtras(loop: Loop, opts: RunOptions): Promise<void> {
  if (!loop.also?.length) return;
  const allowedClasses = loop.policy?.auto ?? [];
  const eff = resolveModels(opts.modelPolicy, loop.models);
  for (const action of loop.also) {
    try {
      emit(opts, { type: "model", node: "also", tier: eff.phases.also, model: modelForPhase(eff, "also", opts.cliModel) });
      const res = await opts.runner.act({
        goal: `${loop.goal} — finishing pass: ${action}`,
        plan: action,
        allowedClasses,
        baseDir: opts.baseDir,
        model: modelForPhase(eff, "also", opts.cliModel),
      });
      emit(opts, { type: "also", action, ok: !res.blocked, detail: res.summary });
    } catch (err) {
      emit(opts, { type: "also", action, ok: false, detail: String((err as Error)?.message ?? err) });
    }
  }
}

/** Runs a loop, then its finishing passes if it succeeded. */
async function executeLoopFull(loop: Loop, opts: RunOptions): Promise<LoopOutcome> {
  const outcome = await executeLoop(loop, opts);
  if (outcome.satisfied) await runExtras(loop, opts);
  return outcome;
}

async function writeBackArchon(loop: Loop, opts: RunOptions, satisfied: boolean): Promise<void> {
  if (loop.planSource?.type === "archon" && opts.archon?.complete) {
    await opts.archon.complete({ project: loop.planSource.project, goal: loop.goal, satisfied });
  }
}

/** Run a single definition (a loop or a pipeline). */
export async function runDefinition(def: Definition, opts: RunOptions): Promise<LoopOutcome> {
  if (def.kind === "pipeline") return executePipeline(def, opts);
  if (def.kind === "flow") return executeFlow(def, opts);
  const outcome = await executeLoopFull(def, opts);
  await writeBackArchon(def, opts, outcome.satisfied);
  return outcome;
}

/** Run every definition in a parsed file, in order. */
export async function run(file: LoopFile, opts: RunOptions): Promise<LoopOutcome[]> {
  const outer = !opts.gitStarted && !!opts.git;
  if (outer) {
    const policy = resolveGit(opts.gitPolicy, file.config?.git);
    let o: RunOptions = { ...opts, gitPolicy: file.config?.git ?? opts.gitPolicy, gitStarted: true };
    let branch = "";
    if (policy.isolation !== "in-place") {
      const firstName = file.definitions[0] && ("name" in file.definitions[0] ? (file.definitions[0] as any).name : null);
      const name = `loop/${slug(firstName)}`;
      const ctx = await opts.git!.start({ isolation: policy.isolation, branch: policy.branch, name, baseDir: opts.baseDir });
      branch = ctx.branch;
      o = { ...o, baseDir: ctx.dir, gitBranch: branch };
      emit(o, { type: "git", action: policy.isolation === "worktree" ? "worktree" : "branch", detail: branch });
    } else {
      const ctx = await opts.git!.start({ isolation: "in-place", branch: policy.branch, name: "loop", baseDir: opts.baseDir });
      branch = ctx.branch;
      o = { ...o, baseDir: ctx.dir, gitBranch: branch };
    }
    if (policy.push && isProtected(branch)) {
      throw new Error(`git: refusing to push to "${branch}" — add 'work on a branch' (never push to a protected branch)`);
    }
    const outcomes: LoopOutcome[] = [];
    for (const def of file.definitions) outcomes.push(await runDefinition(def, o));
    const allOk = outcomes.every((x) => x.satisfied);
    if (allOk && policy.commit === "done") await gitCommit(o, `loop: ${slug(file.definitions[0] && (file.definitions[0] as any).name)} — goal met`);
    if (allOk && policy.push) { await o.git!.push({ branch, dir: o.baseDir }); emit(o, { type: "git", action: "push", detail: branch }); }
    if (allOk && policy.openPr) { const url = await o.git!.openPr({ title: `loop: ${branch}`, branch, dir: o.baseDir }); emit(o, { type: "git", action: "pr", detail: url ?? branch }); }
    return outcomes;
  }
  const outcomes: LoopOutcome[] = [];
  for (const def of file.definitions) outcomes.push(await runDefinition(def, opts));
  return outcomes;
}
