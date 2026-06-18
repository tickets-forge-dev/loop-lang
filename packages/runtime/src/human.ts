import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { HumanIO } from "./types.js";

/** Blocking CLI human gate: prompts y/n on the terminal. */
export class CliHumanIO implements HumanIO {
  private async yn(question: string): Promise<boolean> {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
      return ans === "y" || ans === "yes";
    } finally {
      rl.close();
    }
  }

  plan(goal: string, plan: string): Promise<boolean> {
    stdout.write(`\n— plan for "${goal}" —\n${plan}\n`);
    return this.yn("Approve this plan?");
  }
  review(goal: string): Promise<boolean> {
    return this.yn(`Does the result for "${goal}" look right?`);
  }
  gate(message: string): Promise<boolean> {
    return this.yn(`GATE: ${message}. Proceed?`);
  }
  confirm(actionClass: string): Promise<boolean> {
    return this.yn(`Allow "${actionClass}" actions this run?`);
  }
  async ask(prompt: string): Promise<void> {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      await rl.question(`Blocked on "${prompt}". Resolve, then press Enter to continue… `);
    } finally {
      rl.close();
    }
  }
}

/**
 * Non-interactive HumanIO driven by canned answers — for tests and headless runs.
 * Each method pulls the next answer from its queue, falling back to `defaults`.
 */
export interface ScriptedAnswers {
  plan?: boolean[];
  review?: boolean[];
  gate?: boolean[];
  confirm?: Record<string, boolean>;
  defaults?: { plan?: boolean; review?: boolean; gate?: boolean; confirm?: boolean };
}

export class ScriptedHumanIO implements HumanIO {
  public readonly calls: Array<{ kind: string; arg: string }> = [];
  private idx = { plan: 0, review: 0, gate: 0 };

  constructor(private answers: ScriptedAnswers = {}) {}

  private next(kind: "plan" | "review" | "gate"): boolean {
    const arr = this.answers[kind];
    const i = this.idx[kind]++;
    if (arr && i < arr.length) return arr[i];
    return this.answers.defaults?.[kind] ?? true;
  }

  async plan(goal: string): Promise<boolean> {
    this.calls.push({ kind: "plan", arg: goal });
    return this.next("plan");
  }
  async review(goal: string): Promise<boolean> {
    this.calls.push({ kind: "review", arg: goal });
    return this.next("review");
  }
  async gate(message: string): Promise<boolean> {
    this.calls.push({ kind: "gate", arg: message });
    return this.next("gate");
  }
  async confirm(actionClass: string): Promise<boolean> {
    this.calls.push({ kind: "confirm", arg: actionClass });
    if (this.answers.confirm && actionClass in this.answers.confirm) return this.answers.confirm[actionClass];
    return this.answers.defaults?.confirm ?? true;
  }
  async ask(prompt: string): Promise<void> {
    this.calls.push({ kind: "ask", arg: prompt });
  }
}
