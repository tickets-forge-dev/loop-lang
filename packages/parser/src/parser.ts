import {
  Action,
  Config,
  CycleStep,
  Definition,
  Flow,
  FlowStep,
  Loop,
  LoopContext,
  LoopFile,
  LOOP_VERSION,
  ParseError,
  Pipeline,
  Policy,
  Predicate,
  Stage,
  Transition,
} from "./types.js";

interface Line {
  indent: number;
  text: string;
  lineNo: number;
}

/** Action-class normalization: plurals/synonyms -> canonical class. */
function normalizeActionClass(word: string): string {
  const w = word.trim().toLowerCase().replace(/[.,]$/, "");
  const map: Record<string, string> = {
    edit: "edit",
    edits: "edit",
    editing: "edit",
    migration: "migrate",
    migrations: "migrate",
    migrate: "migrate",
    push: "push",
    pushes: "push",
    pushing: "push",
    deploy: "deploy",
    deploys: "deploy",
    deployment: "deploy",
    deployments: "deploy",
    delete: "delete",
    deletes: "delete",
    deletion: "delete",
    deletions: "delete",
  };
  return map[w] ?? w;
}

/** Split "migrations or pushes", "edits and deploys", "a, b, c" into classes. */
function splitClasses(s: string): string[] {
  return s
    .split(/,|\bor\b|\band\b/)
    .map((p) => normalizeActionClass(p))
    .filter((p) => p.length > 0);
}

function tokenizeLines(src: string): Line[] {
  const out: Line[] = [];
  const raw = src.replace(/\r\n/g, "\n").split("\n");
  raw.forEach((original, idx) => {
    const lineNo = idx + 1;
    // strip comments (# ...) that are not inside quotes
    let stripped = "";
    let inQuote = false;
    for (let i = 0; i < original.length; i++) {
      const c = original[i];
      if (c === '"') inQuote = !inQuote;
      if (c === "#" && !inQuote) break;
      stripped += c;
    }
    if (stripped.trim().length === 0) return;
    const indent = stripped.length - stripped.trimStart().length;
    out.push({ indent, text: stripped.trim(), lineNo });
  });
  return out;
}

/** Collect the contiguous run of lines more indented than `headerIndent`. */
function childrenOf(lines: Line[], start: number, headerIndent: number): { body: Line[]; next: number } {
  const body: Line[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent > headerIndent) {
    body.push(lines[i]);
    i++;
  }
  return { body, next: i };
}

function quoted(s: string): string | null {
  const m = s.match(/"([^"]*)"/);
  return m ? m[1] : null;
}

// ---------- predicate (`done when ...`) ----------

function parsePredicate(s: string, lineNo: number): Predicate {
  const text = s.trim();
  // the test "X" passes
  let m = text.match(/^the test\s+"([^"]+)"\s+passes$/i);
  if (m) return { type: "test", target: m[1] };

  // "CMD" finds nothing  -> command, expect empty
  m = text.match(/^"([^"]+)"\s+finds nothing$/i);
  if (m) return { type: "command", command: m[1], expect: "empty" };

  // "CMD" passes / succeeds  -> command, exit-zero
  m = text.match(/^"([^"]+)"\s+(?:passes|succeeds)$/i);
  if (m) return { type: "command", command: m[1], expect: "exit-zero" };

  // a human confirms "..."
  m = text.match(/^a human confirms\s+"([^"]+)"$/i);
  if (m) return { type: "human", description: m[1] };

  throw new ParseError(`could not understand "done when ${text}"`, lineNo);
}

// ---------- action lists (transition `do:` and `after N tries:`) ----------

function parseActions(s: string, lineNo: number): Action[] {
  // split on "then" or commas
  const parts = s
    .split(/,|\bthen\b/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const actions: Action[] = [];
  for (const part of parts) {
    const p = part.toLowerCase();
    // stop and warn "X"
    let m = part.match(/^stop and warn\s+"([^"]+)"$/i);
    if (m) {
      actions.push({ action: "stop", warn: m[1] });
      continue;
    }
    if (p === "stop") {
      actions.push({ action: "stop" });
      continue;
    }
    // reflect on X  /  reflect
    m = part.match(/^reflect(?:\s+on\s+(.+))?$/i);
    if (m) {
      actions.push(m[1] ? { action: "reflect", focus: m[1].trim() } : { action: "reflect" });
      continue;
    }
    if (p === "plan" || p === "plan again" || p === "replan") {
      actions.push({ action: "plan" });
      continue;
    }
    if (p === "act" || p === "act again") {
      actions.push({ action: "act" });
      continue;
    }
    if (p === "observe") {
      actions.push({ action: "observe" });
      continue;
    }
    if (p === "ask a human" || p === "ask the human" || p === "ask human") {
      actions.push({ action: "ask-human" });
      continue;
    }
    throw new ParseError(`unknown action "${part}"`, lineNo);
  }
  if (actions.length === 0) throw new ParseError(`expected at least one action`, lineNo);
  return actions;
}

function parseWhenCondition(cond: string, lineNo: number): Pick<Transition, "on" | "requireGoalMet"> {
  const c = cond.trim().toLowerCase();
  if (/^it passes and (the )?goal is met$/.test(c)) return { on: "pass", requireGoalMet: true };
  if (/^it passes$/.test(c)) return { on: "pass" };
  if (/^it fails$/.test(c)) return { on: "fail" };
  if (/^(it is )?blocked$/.test(c)) return { on: "blocked" };
  throw new ParseError(`unknown condition "when ${cond}"`, lineNo);
}

// ---------- cycle (`each cycle: plan, then act, then observe`) ----------

function parseCycle(s: string, lineNo: number): CycleStep[] {
  const steps = s
    .split(/,|\bthen\b/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const out: CycleStep[] = [];
  for (const step of steps) {
    if (step === "plan" || step === "act" || step === "observe") {
      out.push(step);
    } else {
      throw new ParseError(`unknown cycle step "${step}" (expected plan, act, or observe)`, lineNo);
    }
  }
  if (out.length === 0) throw new ParseError(`empty cycle`, lineNo);
  return out;
}

// ---------- loop body ----------

interface LoopBodyResult {
  loop: Loop;
  gate: { message: string } | null;
}

function interpretLoopBody(name: string | null, body: Line[]): LoopBodyResult {
  const loop: Loop = { kind: "loop", name, goal: "", cycle: [] };
  let gate: { message: string } | null = null;
  let sawGoal = false;
  let sawCycle = false;

  for (const ln of body) {
    const t = ln.text;

    let m: RegExpMatchArray | null;

    if ((m = t.match(/^goal:\s*(.+)$/i))) {
      loop.goal = m[1].trim();
      sawGoal = true;
      continue;
    }
    if ((m = t.match(/^done when\s+(.+)$/i))) {
      loop.doneWhen = parsePredicate(m[1], ln.lineNo);
      continue;
    }
    if ((m = t.match(/^look at:\s*(.+)$/i))) {
      loop.context = parseContext(m[1]);
      continue;
    }
    if (/^allow\b/i.test(t) || /^ask me before\b/i.test(t)) {
      mergePolicy(loop, t);
      continue;
    }
    if ((m = t.match(/^(?:then\s+)?each cycle:\s*(.+)$/i))) {
      loop.cycle = parseCycle(m[1], ln.lineNo);
      sawCycle = true;
      continue;
    }
    if ((m = t.match(/^also(?:\s+do)?:\s*(.+)$/i))) {
      loop.also = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      continue;
    }
    if ((m = t.match(/^plan from (?:the )?archon(?:\s+project\s+"([^"]+)")?$/i))) {
      loop.planSource = { type: "archon", ...(m[1] ? { project: m[1] } : {}) };
      continue;
    }
    if (/^a human approves the plan first$/i.test(t)) {
      loop.humanPlan = true;
      continue;
    }
    if (/^a human reviews before stopping$/i.test(t)) {
      loop.humanReviewBeforeStop = true;
      continue;
    }
    if ((m = t.match(/^a human approves before\s+(.+)$/i))) {
      gate = { message: `approve before ${m[1].trim()}` };
      continue;
    }
    if ((m = t.match(/^when\s+(.+?):\s*(.+)$/i))) {
      const base = parseWhenCondition(m[1], ln.lineNo);
      const actions = parseActions(m[2], ln.lineNo);
      (loop.transitions ??= []).push({ ...base, do: actions });
      continue;
    }
    if ((m = t.match(/^after\s+(\d+)\s+tries:\s*(.+)$/i))) {
      const actions = parseActions(m[2], ln.lineNo);
      (loop.transitions ??= []).push({ on: "attempts", threshold: parseInt(m[1], 10), do: actions });
      continue;
    }

    throw new ParseError(`unrecognized line: "${t}"`, ln.lineNo);
  }

  if (!sawGoal) throw new ParseError(`loop "${name ?? "(anonymous)"}" is missing a goal`, body[0]?.lineNo ?? 0);
  if (!sawCycle) loop.cycle = ["plan", "act", "observe"]; // sensible default
  return { loop, gate };
}

function parseContext(s: string): LoopContext {
  const ctx: LoopContext = {};
  const items = s.split(",").map((p) => p.trim()).filter(Boolean);
  const files: string[] = [];
  for (let item of items) {
    item = item.replace(/^and\s+/i, "").trim();
    if (/^the last failure$/i.test(item)) {
      ctx.includeLastFailure = true;
    } else if (item.length > 0) {
      files.push(item);
    }
  }
  if (files.length) ctx.files = files;
  return ctx;
}

function mergePolicy(loop: Loop, line: string) {
  const policy: Policy = loop.policy ?? {};
  // allow <classes> automatically
  let m = line.match(/allow\s+(.+?)\s+automatically/i);
  if (m) {
    policy.auto = [...(policy.auto ?? []), ...splitClasses(m[1])];
  }
  // ask me before <classes>
  m = line.match(/ask me before\s+(.+?)(?:\.|$)/i);
  if (m) {
    policy.confirm = [...(policy.confirm ?? []), ...splitClasses(m[1])];
  }
  loop.policy = policy;
}

// ---------- pipeline / stage ----------

function parseStage(lines: Line[], start: number): { stage: Stage; next: number } {
  const header = lines[start];
  const m = header.text.match(/^stage\s+(.+?):\s*$/i);
  if (!m) throw new ParseError(`expected "stage <name>:"`, header.lineNo);
  const raw = m[1].trim();
  // Stage names may be quoted (e.g. story names with colons/spaces): strip the quotes.
  const name = quoted(raw) ?? raw;
  const { body, next } = childrenOf(lines, start + 1, header.indent);
  if (body.length === 0) throw new ParseError(`stage "${name}" has no body`, header.lineNo);
  const { loop, gate } = interpretLoopBody(null, body);
  return { stage: { name, gate, loop }, next };
}

function parsePipeline(lines: Line[], start: number): { pipeline: Pipeline; next: number } {
  const header = lines[start];
  const name = quoted(header.text) ?? header.text.replace(/^pipeline\s+/i, "").replace(/:$/, "").trim();
  const { body, next } = childrenOf(lines, start + 1, header.indent);
  const stages: Stage[] = [];
  let i = 0;
  // body is a slice; re-walk by indentation relative to the stage headers
  while (i < body.length) {
    if (!/^stage\b/i.test(body[i].text)) {
      throw new ParseError(`expected a "stage" inside pipeline "${name}"`, body[i].lineNo);
    }
    const { stage, next: sn } = parseStage(body, i);
    stages.push(stage);
    i = sn;
  }
  if (stages.length === 0) throw new ParseError(`pipeline "${name}" has no stages`, header.lineNo);
  return { pipeline: { kind: "pipeline", name, stages }, next };
}

function parseLoopDef(lines: Line[], start: number): { loop: Loop; next: number } {
  const header = lines[start];
  const name = quoted(header.text);
  const { body, next } = childrenOf(lines, start + 1, header.indent);
  const { loop } = interpretLoopBody(name, body);
  return { loop, next };
}

function parseFlowStep(lines: Line[], start: number): { step: FlowStep; next: number } {
  const header = lines[start];

  // Handle for-each header
  const fe = header.text.match(/^(?:then\s+)?for each\s+(\w+)\s+in\s+"([^"]+)":$/i);
  if (fe) {
    const varName = fe[1];
    const source = fe[2];
    const { body, next } = childrenOf(lines, start + 1, header.indent);
    let template: string | null = null;
    let gate: { message: string } | null = null;
    for (const ln of body) {
      const r = ln.text.match(/^run\s+"([^"]+)"$/i);
      if (r) { template = r[1]; continue; }
      if (/^a human approves(?:\s+(?:the plan\s+)?first)?$/i.test(ln.text)) { gate = { message: `approve before ${varName}` }; continue; }
      const g = ln.text.match(/^a human approves before\s+(.+)$/i);
      if (g) { gate = { message: `approve before ${g[1].trim()}` }; continue; }
      // Only complain about unrecognized lines if we're not looking for a template child
      if (template === null) {
        throw new ParseError(`'for each ${varName}' needs a 'run "<template>"' child`, header.lineNo);
      }
      throw new ParseError(`unrecognized line in 'for each ${varName}': "${ln.text}"`, ln.lineNo);
    }
    if (!template) throw new ParseError(`'for each ${varName}' needs a 'run "<template>"' child`, header.lineNo);
    const step: FlowStep = { ref: template, name: varName, forEach: { var: varName, source } };
    if (gate) step.gate = gate;
    return { step, next };
  }

  // Handle run header
  const m = header.text.match(/^(?:then\s+)?run\s+"([^"]+)"(?:\s+with the result of\s+([^:]+))?:?$/i);
  if (!m) throw new ParseError(`expected 'run "<file>"' in flow`, header.lineNo);
  const ref = m[1];
  const name = (ref.split("/").pop() ?? ref).replace(/\.loop$/i, "");
  const step: FlowStep = { ref, name };
  if (m[2]) step.fromStep = m[2].trim();
  const { body, next } = childrenOf(lines, start + 1, header.indent);
  for (const ln of body) {
    if (/^a human approves(?:\s+(?:the plan\s+)?first)?$/i.test(ln.text)) {
      step.gate = { message: `approve before ${name}` };
      continue;
    }
    const g = ln.text.match(/^a human approves before\s+(.+)$/i);
    if (g) {
      step.gate = { message: `approve before ${g[1].trim()}` };
      continue;
    }
    throw new ParseError(`unrecognized line in flow step "${name}": "${ln.text}"`, ln.lineNo);
  }
  return { step, next };
}

function parseFlow(lines: Line[], start: number): { flow: Flow; next: number } {
  const header = lines[start];
  const name = quoted(header.text) ?? header.text.replace(/^flow\s+/i, "").replace(/:$/, "").trim();
  const { body, next } = childrenOf(lines, start + 1, header.indent);
  const steps: FlowStep[] = [];
  let i = 0;
  while (i < body.length) {
    if (!/^(?:then\s+)?run\b/i.test(body[i].text) && !/^(?:then\s+)?for each\b/i.test(body[i].text)) {
      throw new ParseError(`expected 'run "<file>"' or 'for each <var> in "<file>":' inside flow "${name}"`, body[i].lineNo);
    }
    const { step, next: sn } = parseFlowStep(body, i);
    steps.push(step);
    i = sn;
  }
  if (steps.length === 0) throw new ParseError(`flow "${name}" has no steps`, header.lineNo);
  return { flow: { kind: "flow", name, steps }, next };
}

// ---------- config ----------

function parseConfigLine(config: Config, ln: Line): boolean {
  const t = ln.text;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^use\s+(?:the\s+)?(.+?)(?:\s+method)?$/i))) {
    config.use = m[1].trim();
    return true;
  }
  if ((m = t.match(/^run with\s+(.+)$/i)) || (m = t.match(/^runner\s+(.+)$/i))) {
    config.runner = m[1].trim().toLowerCase().replace(/\s+/g, "-");
    return true;
  }
  if ((m = t.match(/^schedule:\s*(.+)$/i))) {
    config.schedule = m[1].trim();
    return true;
  }
  if ((m = t.match(/^target:\s*(.+)$/i))) {
    config.target = m[1].trim();
    return true;
  }
  if ((m = t.match(/^notify:\s*(.+)$/i))) {
    config.notify = m[1].trim();
    return true;
  }
  return false;
}

// ---------- entry ----------

export function parse(src: string): LoopFile {
  const lines = tokenizeLines(src);
  const config: Config = {};
  const definitions: Definition[] = [];
  let i = 0;

  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent !== 0) {
      throw new ParseError(`unexpected indentation at top level: "${ln.text}"`, ln.lineNo);
    }
    if (/^loop\b/i.test(ln.text)) {
      const { loop, next } = parseLoopDef(lines, i);
      definitions.push(loop);
      i = next;
    } else if (/^pipeline\b/i.test(ln.text)) {
      const { pipeline, next } = parsePipeline(lines, i);
      definitions.push(pipeline);
      i = next;
    } else if (/^flow\b/i.test(ln.text)) {
      const { flow, next } = parseFlow(lines, i);
      definitions.push(flow);
      i = next;
    } else if (parseConfigLine(config, ln)) {
      i++;
    } else {
      throw new ParseError(`unrecognized top-level line: "${ln.text}"`, ln.lineNo);
    }
  }

  const hasConfig = Object.keys(config).length > 0;
  return {
    loopVersion: LOOP_VERSION,
    config: hasConfig ? config : null,
    definitions,
  };
}
