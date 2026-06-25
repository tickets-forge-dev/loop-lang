// Runs after `npm install -g @loop-lang/loop`.
// On a global install, copies the /loopflow skill to ~/.claude/skills/loopflow
// so every Claude Code session in every project has access to /loopflow.
// Skips silently on local installs and when the skill already exists.
import { cp, mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const isGlobal = process.env.npm_config_global === "true";
if (!isGlobal) process.exit(0);

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "assets", "skill");
const dst = join(homedir(), ".claude", "skills", "loopflow");

const exists = (p) => access(p).then(() => true, () => false);

try {
  if (await exists(dst)) {
    console.log(`  loop: /loopflow skill already at ~/.claude/skills/loopflow — skipped.`);
    console.log(`  Run \`loop init --global --force\` to overwrite.`);
  } else {
    await mkdir(join(homedir(), ".claude", "skills"), { recursive: true });
    await cp(src, dst, { recursive: true });
    console.log(`  loop: installed /loopflow skill → ~/.claude/skills/loopflow`);
    console.log(`  Open any Claude Code session and type /loopflow to start.`);
  }
} catch (err) {
  // Non-fatal — don't break the install.
  console.warn(`  loop: could not install /loopflow skill: ${err.message}`);
  console.warn(`  Run \`loop init --global\` manually to install it.`);
}
