export interface SessionCommandInput {
  binary: string;
  model?: string;
  targetPath: string;
}

// Quote an argument for a POSIX shell (the common integrated-terminal case): double-quote and escape.
export function shq(s: string): string {
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function buildClaudeSessionCommand(input: SessionCommandInput): string {
  const model = input.model ? ` --model ${shq(input.model)}` : "";
  return `${input.binary}${model} ${shq(`/loopflow run ${input.targetPath}`)}`;
}

export function buildPiSessionCommand(input: SessionCommandInput): string {
  const model = input.model ? ` --model ${shq(input.model)}` : "";
  return `${input.binary}${model} ${shq(`/skill:loopflow run ${input.targetPath}`)}`;
}
