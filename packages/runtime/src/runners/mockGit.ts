import { isProtected, type GitIO } from "../git.js";
export class MockGitIO implements GitIO {
  public calls: string[] = [];
  constructor(private branchName = "loop/test") {}
  async start(i: any) { this.calls.push(`start:${i.isolation}`); return { dir: i.baseDir, branch: i.branch ?? this.branchName }; }
  async commit(i: any) { this.calls.push(`commit:${i.message}`); }
  async push(i: any) { if (isProtected(i.branch)) throw new Error(`refusing to push to protected branch "${i.branch}"`); this.calls.push(`push:${i.branch}`); }
  async openPr(i: any) { this.calls.push(`pr:${i.branch}`); return "https://example/pr/1"; }
}
