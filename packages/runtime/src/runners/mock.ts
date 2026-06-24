import type { ActInput, ActResult, PlanInput, ReflectInput, Runner, SkillVerifyInput } from "../types.js";

export interface MockRunnerOptions {
  planText?: (input: PlanInput) => string;
  act?: (input: ActInput) => ActResult;
  reflectText?: (input: ReflectInput) => string;
  skill?: (input: SkillVerifyInput) => { passed: boolean; detail: string };
}

/**
 * Deterministic Runner for tests and the offline demo. Records every call so the
 * orchestration logic (cycles, back-edges, policy grants) can be asserted without
 * touching Claude Code.
 */
export class MockRunner implements Runner {
  public readonly planCalls: PlanInput[] = [];
  public readonly actCalls: ActInput[] = [];
  public readonly reflectCalls: ReflectInput[] = [];
  public readonly skillCalls: SkillVerifyInput[] = [];

  constructor(private opts: MockRunnerOptions = {}) {}

  async plan(input: PlanInput): Promise<string> {
    this.planCalls.push(input);
    return this.opts.planText?.(input) ?? `plan for: ${input.goal}`;
  }
  async act(input: ActInput): Promise<ActResult> {
    this.actCalls.push(input);
    return this.opts.act?.(input) ?? { summary: `acted on: ${input.goal}` };
  }
  async reflect(input: ReflectInput): Promise<string> {
    this.reflectCalls.push(input);
    return this.opts.reflectText?.(input) ?? `reflection (${input.focus ?? "general"})`;
  }
  async runSkill(input: SkillVerifyInput): Promise<{ passed: boolean; detail: string }> {
    this.skillCalls.push(input);
    return this.opts.skill?.(input) ?? { passed: true, detail: `${input.skill}: APPROVED` };
  }
}
