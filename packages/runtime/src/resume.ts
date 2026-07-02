import type { LoopEvent, ResumePlan, ResumeScope } from "./types.js";

/**
 * Resume-from-log: rebuild "what already finished" from a prior run's NDJSON event log
 * (`--log run.log` → crash/Ctrl-C → `--resume run.log`).
 *
 * The log is a flat stream, but nested work (a flow step running a whole sub-file, a foreach
 * item running a template) emits its own loop/pipeline/flow events inside it. Two counters keep
 * the scan honest:
 *
 *  - a **container stack** of open loop/pipeline/flow definitions — an `*-end` that empties the
 *    stack closes a *top-level* definition (stage loops and sub-file runs pop back to a non-empty
 *    stack, so they never miscount);
 *  - a **step depth** of open flow-steps / foreach-items — units nested inside another step are
 *    someone else's business (their parent's end event already summarises them).
 *
 * Only units that ended `satisfied: true` are recorded. An interrupted unit has no end event, a
 * failed one has `satisfied: false` — both re-run on resume, which is exactly the semantic you
 * want: "skip what's proven done, redo what isn't".
 *
 * A log may contain several headers (a resumed run appending to the same file) — keys simply
 * accumulate; the latest header's hash wins.
 */
export function buildResumePlan(logText: string): ResumePlan {
  const completed = new Set<string>();
  const summaries = new Map<string, string>();
  let sourceHash: string | undefined;
  let runId: string | undefined;

  const stack: string[] = []; // open definition containers (loop / pipeline / flow)
  let defOrdinal = 0;         // index of the next top-level definition to close
  let stepDepth = 0;          // open flow-steps + foreach-items
  let curStep: string | null = null; // the open top-level flow step (for foreach item keys)

  for (const line of logText.split("\n")) {
    if (!line.trim()) continue;
    let o: { v?: string; runId?: string; meta?: { loop_sha256?: string }; event?: LoopEvent };
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a torn tail line (crash mid-write) is expected — ignore
    }
    if (o.v === "loop.log.v1") {
      sourceHash = o.meta?.loop_sha256 ?? sourceHash;
      runId = o.runId ?? runId;
      continue;
    }
    const e = o.event;
    if (!e || typeof (e as { type?: unknown }).type !== "string") continue;

    switch (e.type) {
      case "loop-start":
      case "pipeline-start":
      case "flow-start":
        stack.push(e.type);
        break;

      case "loop-end":
      case "pipeline-end":
      case "flow-end":
        stack.pop();
        if (stack.length === 0 && stepDepth === 0) {
          if (e.satisfied) completed.add(`def:${defOrdinal}`);
          defOrdinal++;
        }
        break;

      case "stage-end":
        // A top-level pipeline's stage: exactly the pipeline itself on the stack.
        if (stack.length === 1 && stepDepth === 0 && e.satisfied) {
          completed.add(`stage:${defOrdinal}:${e.name}`);
        }
        break;

      case "flow-step-start":
        if (stepDepth === 0 && stack.length === 1) curStep = e.name;
        stepDepth++;
        break;

      case "flow-step-end":
        stepDepth--;
        if (stepDepth === 0 && stack.length === 1) {
          if (e.satisfied) {
            const key = `step:${defOrdinal}:${e.name}`;
            completed.add(key);
            if (e.summary) summaries.set(key, e.summary);
          }
          curStep = null;
        }
        break;

      case "foreach-item-start":
        stepDepth++;
        break;

      case "foreach-item-end":
        stepDepth--;
        // Items of a top-level flow's step sit one step deep (inside the open flow-step).
        if (stepDepth === 1 && stack.length === 1 && curStep && e.satisfied) {
          completed.add(`item:${defOrdinal}:${curStep}:${e.var}:${e.index}`);
        }
        break;
    }
  }
  return { completed, summaries, sourceHash, runId };
}

/** Slice a plan down to one definition's units — what the executors actually consult. */
export function scopeResume(plan: ResumePlan | undefined, defIndex: number): ResumeScope | undefined {
  if (!plan) return undefined;
  const stages = new Set<string>();
  const steps = new Map<string, string | true>();
  const items = new Map<string, Set<number>>();
  const stagePrefix = `stage:${defIndex}:`;
  const stepPrefix = `step:${defIndex}:`;
  const itemPrefix = `item:${defIndex}:`;
  for (const key of plan.completed) {
    if (key.startsWith(stagePrefix)) stages.add(key.slice(stagePrefix.length));
    else if (key.startsWith(stepPrefix)) {
      const name = key.slice(stepPrefix.length);
      steps.set(name, plan.summaries.get(key) ?? true);
    } else if (key.startsWith(itemPrefix)) {
      // item:<i>:<step>:<var>:<idx> — index is the final segment; step/var may themselves hold ':'-free names.
      const rest = key.slice(itemPrefix.length);
      const lastColon = rest.lastIndexOf(":");
      const idx = parseInt(rest.slice(lastColon + 1), 10);
      const stepVar = rest.slice(0, lastColon);
      if (!Number.isNaN(idx)) {
        if (!items.has(stepVar)) items.set(stepVar, new Set());
        items.get(stepVar)!.add(idx);
      }
    }
  }
  if (!stages.size && !steps.size && !items.size) return undefined;
  return { stages, steps, items };
}
