#!/usr/bin/env node
// @loop-lang/loop — the installer CLI. `loop init` drops Loop into a repo so any
// agent can author + run .loop files. Running loops happens in your agent (the
// /loopflow skill) or headless via the full @loop-lang/runtime CLI.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { init } from "./init.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, "..", "assets");

const HELP = `loop — install Loop into your repo so any agent can author + run .loop files

usage:
  loop init [options]      scaffold Loop into the current repo
  loop help                show this

init options:
  --dir <path>     install into <path> (default: current directory)
  --global         install the /loopflow skill into ~/.claude/skills (done automatically on \`npm install -g\`)
  --no-skill       don't install the Claude Code /loopflow skill
  --no-example     don't write examples/fix_test.loop
  --no-claude-md   don't write the CLAUDE.md pointer (written by default)
  --cursor         also write .cursor/rules/loop.md
  --copilot        also write .github/copilot-instructions.md
  --all-agents     CLAUDE.md + Cursor + Copilot pointers
  --force          overwrite the skill / example if they already exist

after init:
  • Claude Code: open a chat in the repo and say  /loopflow run examples/fix_test.loop
  • any agent:   it reads AGENTS.md and can author + run .loop files
  • headless:    install @loop-lang/runtime for  loop-run run <file>`;

function flag(argv, name) { return argv.includes(name); }
function opt(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

async function main(argv) {
  const cmd = argv[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }

  if (cmd === "init") {
    const agents = [];
    if (flag(argv, "--all-agents")) agents.push("claude", "cursor", "copilot");
    // CLAUDE.md pointer is on by default (gives Claude Code a standing "author a .loop"
    // nudge); --no-claude-md opts out. --claude-md still accepted as an explicit yes.
    if (!flag(argv, "--no-claude-md") && !agents.includes("claude")) agents.push("claude");
    if (flag(argv, "--cursor") && !agents.includes("cursor")) agents.push("cursor");
    if (flag(argv, "--copilot") && !agents.includes("copilot")) agents.push("copilot");

    const targetDir = resolve(process.cwd(), opt(argv, "--dir") ?? ".");
    const skill = flag(argv, "--no-skill") ? "none" : flag(argv, "--global") ? "global" : "local";

    const { steps } = await init(targetDir, {
      skill,
      agents,
      example: !flag(argv, "--no-example"),
      force: flag(argv, "--force"),
    }, ASSETS);

    console.log(`\n  Loop installed into ${targetDir}\n`);
    for (const s of steps) console.log(`  ✓ ${s}`);
    console.log(`\n  Next:`);
    console.log(`    • In a Claude Code chat here:  /loopflow run examples/fix_test.loop`);
    console.log(`    • Or describe the work and the agent writes the .loop for you.`);
    console.log(`    • Any other agent reads AGENTS.md and can do the same.\n`);
    return;
  }

  if (["run", "parse", "viz", "show", "ls"].includes(cmd)) {
    console.error(`\`loop ${cmd}\` runs in your agent (the /loopflow skill) or via the full runtime CLI: \`loop-run ${cmd}\` (install @loop-lang/runtime).\nThis package installs Loop — try \`loop init\`. See \`loop help\`.`);
    process.exit(2);
  }

  console.error(`unknown command: ${cmd}\n`);
  console.log(HELP);
  process.exit(2);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
