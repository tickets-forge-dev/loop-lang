import { exec } from "node:child_process";
import type { Predicate } from "@loop-lang/parser";
import type { VerifyResult, Verifier } from "./types.js";

/**
 * TRUST MODEL — read before changing this to execFile/spawn.
 *
 * A `done when` predicate command (e.g. `semgrep --severity=high`, `pnpm test`,
 * `./scripts/health.sh`) is written by the author of the .loop file and is *meant*
 * to be a shell command — it routinely uses flags, pipes, and `&&`. The author is
 * the operator; this runs with their own privileges, exactly like an npm script or
 * a Makefile target. It is NOT untrusted external input, so a shell is appropriate.
 *
 * Do NOT feed a .loop file from an untrusted source into the runtime without
 * reviewing its predicate commands first — running it is equivalent to running
 * that person's shell scripts.
 */
function sh(command: string, cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
      const code = err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0;
      resolve({ code, out });
    });
  });
}

export interface ShellVerifierOptions {
  /**
   * Maps a `test` predicate target (e.g. "billing.spec.ts::apostrophe") to a shell command.
   * Default runs it through `npm test`. Override to match your test runner.
   */
  testCommand?: (target: string) => string;
}

/** Verifies predicates by running real shell commands. */
export class ShellVerifier implements Verifier {
  constructor(private opts: ShellVerifierOptions = {}) {}

  async verify(predicate: Predicate | null | undefined, baseDir: string): Promise<VerifyResult> {
    if (!predicate) {
      // No machine-checkable predicate; the loop must rely on a human review to stop.
      return { passed: false, output: "no `done when` predicate; awaiting human review" };
    }

    if (predicate.type === "human") {
      return { passed: false, output: `human check required: ${predicate.description}` };
    }

    if (predicate.type === "skill") {
      // The engine routes skill predicates to the runner's runSkill before reaching here;
      // if one arrives, the runner can't judge it, so it stays unsatisfied.
      return { passed: false, output: `skill review required: ${predicate.skill}` };
    }

    let command: string;
    let expectEmpty = false;
    if (predicate.type === "test") {
      const make = this.opts.testCommand ?? ((t: string) => `npm test -- ${t}`);
      command = make(predicate.target);
    } else {
      command = predicate.command;
      expectEmpty = predicate.expect === "empty";
    }

    const { code, out } = await sh(command, baseDir);
    const passed = expectEmpty ? code === 0 && out.length === 0 : code === 0;
    return { passed, output: out.slice(0, 4000) };
  }
}
