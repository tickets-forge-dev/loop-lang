import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isProtected, type GitIO } from "../git.js";

/**
 * TRUST MODEL — why execFile (not exec) is used here.
 *
 * Branch names and commit messages come from .loop files authored by the
 * operator, but they are still free-form strings that could contain shell
 * metacharacters.  We use execFile() + argument arrays throughout so that
 * no shell is involved and each argument is passed directly to git/gh
 * without interpolation — eliminating command-injection risk even for
 * unusual branch names or commit messages.
 *
 * Do NOT feed a .loop file from an untrusted source into the runtime without
 * reviewing its git policy first — running it is equivalent to running that
 * person's git scripts.
 */
function sh(
  bin: string,
  args: string[],
  cwd: string
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
      const code = err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0;
      resolve({ code, out });
    });
  });
}

function sanitize(s: string): string {
  // Allow alphanumerics, hyphens, underscores, slashes, dots — strip the rest.
  return s.replace(/[^A-Za-z0-9\-_/.]/g, "-");
}

function autoBranch(name: string): string {
  return `loop/${sanitize(name).toLowerCase().slice(0, 48).replace(/\/$/, "")}`;
}

/** Production GitIO that shells real git / gh commands. */
export class ShellGitIO implements GitIO {
  async start(i: {
    isolation: "in-place" | "branch" | "worktree";
    branch?: string;
    name: string;
    baseDir: string;
  }): Promise<{ dir: string; branch: string }> {
    const branch = i.branch ? sanitize(i.branch) : autoBranch(i.name);

    if (i.isolation === "in-place") {
      const { out } = await sh("git", ["rev-parse", "--abbrev-ref", "HEAD"], i.baseDir);
      return { dir: i.baseDir, branch: out || "HEAD" };
    }

    if (i.isolation === "worktree") {
      const dir = join(i.baseDir, ".worktrees", branch.replace(/\//g, "-"));
      mkdirSync(join(i.baseDir, ".worktrees"), { recursive: true });
      const { code, out } = await sh(
        "git",
        ["worktree", "add", dir, "-b", branch],
        i.baseDir
      );
      if (code !== 0) throw new Error(`git worktree add failed: ${out}`);
      return { dir, branch };
    }

    // isolation === "branch"
    const { code, out } = await sh("git", ["checkout", "-b", branch], i.baseDir);
    if (code !== 0) throw new Error(`git checkout -b failed: ${out}`);
    return { dir: i.baseDir, branch };
  }

  async commit(i: { message: string; dir: string }): Promise<void> {
    await sh("git", ["add", "-A"], i.dir);
    const { out } = await sh(
      "git",
      ["commit", "-m", i.message, "--no-verify"],
      i.dir
    );
    // "nothing to commit" is a normal no-op — don't throw.
    if (out.includes("nothing to commit")) return;
  }

  async push(i: { branch: string; dir: string }): Promise<void> {
    // Safety guard: refuse to push directly to protected branches.
    // This runs BEFORE any shell command — it is the production safety barrier.
    if (isProtected(i.branch)) {
      throw new Error(
        `refusing to push to protected branch "${i.branch}" — create a feature branch first`
      );
    }
    const branch = sanitize(i.branch);
    const { code, out } = await sh("git", ["push", "-u", "origin", branch], i.dir);
    if (code !== 0) throw new Error(`git push failed: ${out}`);
  }

  async openPr(i: { title: string; branch: string; dir: string }): Promise<string | null> {
    const branch = sanitize(i.branch);
    const { code, out } = await sh(
      "gh",
      ["pr", "create", "--fill", "--head", branch],
      i.dir
    );
    if (code !== 0) {
      // gh not installed, not authenticated, or network failure — non-fatal.
      return null;
    }
    // gh outputs the PR URL as the last (or only) line on success.
    const lines = out.split("\n").filter(Boolean);
    return lines[lines.length - 1] ?? null;
  }
}
