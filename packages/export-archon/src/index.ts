import type { LoopFile } from "@loop/parser";
import { compileFile, compileDefinition, ExportOptions } from "./compile.js";
import { toYaml } from "./yaml.js";
import type { ArchonWorkflow } from "./types.js";

export { compileFile, compileDefinition } from "./compile.js";
export type { ExportOptions } from "./compile.js";
export { toYaml } from "./yaml.js";
export * from "./types.js";

/** Compile a parsed Loop file and render each workflow as YAML. */
export function exportToArchonYaml(file: LoopFile, opts: ExportOptions = {}): Array<{ name: string; yaml: string }> {
  return compileFile(file, opts).map((wf: ArchonWorkflow) => ({
    name: wf.name,
    yaml: toYaml(wf as unknown as Record<string, never>),
  }));
}
