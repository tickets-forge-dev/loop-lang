// `loop init` — install Loop into a repo so any agent can author + run .loop files.
// Pure-ish: takes a target dir + options + the assets dir; returns the steps taken.
// No external deps (node built-ins only) so the published package runs under npx as-is.
import { readFile, writeFile, mkdir, cp, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const MARK_START = "<!-- loop:start (managed by `loop init` — edits between the markers are overwritten) -->";
const MARK_END = "<!-- loop:end -->";

/** Short pointer dropped into an agent's memory file so it knows Loop lives here. */
export function pointer({ skill }) {
  const run = skill
    ? "run it — in Claude Code via the `/loopflow` skill (installed at `.claude/skills/loopflow`; note: it's `/loopflow`, not the built-in `/loop` scheduler), or headless with `loop run <file>`"
    : "run it headless with `loop run <file>`";
  return [
    "## Loop (`.loop`)",
    "",
    "This repo uses **Loop** — a small natural-language DSL for self-correcting, human-gated coding workflows.",
    "Whenever the user wants to build, fix, automate, or ship something as a repeatable/self-correcting workflow — a bug fix, a feature, an epic, even a whole app — **default to authoring a `.loop` file** rather than doing the work ad hoc. Use the grammar in [`AGENTS.md`](./AGENTS.md), interview the user for the goal/verification/gates first, then " + run + ".",
    "Every time you create or change a `.loop`, print its flow so the user can see the shape.",
  ].join("\n");
}

const exists = (p) => access(p).then(() => true, () => false);

/** Write `body` into `file`, replacing a prior `loop init` block if present, else appending/creating. */
async function mergeMarkered(file, body) {
  const block = `${MARK_START}\n${body}\n${MARK_END}`;
  if (await exists(file)) {
    const cur = await readFile(file, "utf8");
    if (cur.includes(MARK_START) && cur.includes(MARK_END)) {
      const next = cur.replace(new RegExp(`${esc(MARK_START)}[\\s\\S]*?${esc(MARK_END)}`), block);
      await writeFile(file, next);
      return "updated";
    }
    await writeFile(file, `${cur.replace(/\s*$/, "")}\n\n${block}\n`);
    return "appended to";
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${block}\n`);
  return "wrote";
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function copyInto(src, dst, { force }) {
  if (!force && (await exists(dst))) return "skipped";
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { recursive: true });
  return "wrote";
}

/**
 * @param {string} targetDir  repo to install into (usually process.cwd())
 * @param {object} opts  { skill:"local"|"global"|"none", agents:string[], example:boolean, force:boolean }
 * @param {string} assetsDir  this package's assets/ dir (AGENTS.md, skill, examples)
 * @returns {Promise<{steps:string[]}>}
 */
export async function init(targetDir, opts, assetsDir) {
  const { skill = "local", agents = [], example = true, force = false } = opts;
  const steps = [];
  const withSkill = skill !== "none";

  // 1. AGENTS.md — the universal language reference (every agent reads it).
  const agentsBody = await readFile(join(assetsDir, "AGENTS.md"), "utf8");
  const verb = await mergeMarkered(join(targetDir, "AGENTS.md"), agentsBody.trim());
  steps.push(`${verb} AGENTS.md  (the Loop language reference — any agent)`);

  // 2. The Claude Code /loopflow skill.
  if (withSkill) {
    const dst = skill === "global"
      ? join(homedir(), ".claude", "skills", "loopflow")
      : join(targetDir, ".claude", "skills", "loopflow");
    const r = await copyInto(join(assetsDir, "skill"), dst, { force });
    steps.push(`${r === "skipped" ? "skipped (exists)" : "wrote"} ${skill === "global" ? "~/.claude/skills/loopflow" : ".claude/skills/loopflow"}  (the /loopflow skill)`);
  }

  // 3. Opt-in per-agent memory pointers.
  const ptr = pointer({ skill: withSkill });
  if (agents.includes("claude")) {
    const v = await mergeMarkered(join(targetDir, "CLAUDE.md"), ptr);
    steps.push(`${v} CLAUDE.md  (Claude Code memory)`);
  }
  if (agents.includes("cursor")) {
    const v = await mergeMarkered(join(targetDir, ".cursor", "rules", "loop.md"), ptr);
    steps.push(`${v} .cursor/rules/loop.md  (Cursor)`);
  }
  if (agents.includes("copilot")) {
    const v = await mergeMarkered(join(targetDir, ".github", "copilot-instructions.md"), ptr);
    steps.push(`${v} .github/copilot-instructions.md  (GitHub Copilot)`);
  }

  // 4. A starter loop to run.
  if (example) {
    const r = await copyInto(join(assetsDir, "examples", "fix_test.loop"), join(targetDir, "examples", "fix_test.loop"), { force });
    steps.push(`${r === "skipped" ? "skipped (exists)" : "wrote"} examples/fix_test.loop  (a starter loop)`);
  }

  return { steps };
}
