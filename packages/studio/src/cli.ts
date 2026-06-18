#!/usr/bin/env node
import { startStudio } from "./server.js";

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const port = flag("--port") ? parseInt(flag("--port") as string, 10) : 4173;
const model = flag("--model");

startStudio({ port, model }).then(({ port }) => {
  console.log(`\n  Loop Studio → http://localhost:${port}\n`);
  console.log("  chat · .loop · graph — bound to one IR. ▶ Run streams the trace into the graph.");
  console.log("  Runs Claude Code in this directory; confirm-class actions (push/migrate) are auto-denied.\n");
});
