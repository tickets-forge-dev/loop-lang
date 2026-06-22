import type { GitPolicy } from "@loop-lang/parser";
export interface ResolvedGit { isolation: "in-place"|"branch"|"worktree"; branch?: string; commit: "done"|"cycle"|"story"|"never"; push: boolean; openPr: boolean }
export const BUILTIN_GIT: ResolvedGit = { isolation: "branch", branch: undefined, commit: "done", push: false, openPr: false };
export function resolveGit(...levels: (GitPolicy | null | undefined)[]): ResolvedGit {
  const r: ResolvedGit = { ...BUILTIN_GIT };
  for (const lvl of levels) {
    if (!lvl) continue;
    if (lvl.isolation !== undefined) r.isolation = lvl.isolation;
    if (lvl.branch !== undefined) r.branch = lvl.branch;
    if (lvl.commit !== undefined) r.commit = lvl.commit;
    if (lvl.push !== undefined) r.push = lvl.push;
    if (lvl.openPr !== undefined) r.openPr = lvl.openPr;
  }
  return r;
}
const PROTECTED = ["main", "master"];
export function isProtected(branch: string, set: string[] = PROTECTED): boolean {
  return set.includes(branch.trim().toLowerCase());
}
export interface GitIO {
  protectedBranches?: string[];
  start(i: { isolation: "in-place"|"branch"|"worktree"; branch?: string; name: string; baseDir: string }): Promise<{ dir: string; branch: string }>;
  commit(i: { message: string; dir: string }): Promise<void>;
  push(i: { branch: string; dir: string }): Promise<void>;
  openPr(i: { title: string; branch: string; dir: string }): Promise<string | null>;
}
