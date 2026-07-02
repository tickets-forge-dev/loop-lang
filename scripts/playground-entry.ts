/**
 * Browser bundle for the docs playground (docs/playground.html). Everything here is pure
 * TypeScript with no Node APIs, so one esbuild pass makes the whole language toolchain —
 * parse, lint, the ASCII "show" view, and plain-English explain — run client-side.
 *
 * Build (from the repo root):  npm run build:playground
 * Output:                      docs/playground/loop-lang.js  (iife, global `Loop`)
 */
export { parse, ParseError } from "../packages/parser/src/index.js";
export { renderFile, explainFile } from "../packages/runtime/src/show.js";
export { lint } from "../packages/vscode/src/language.js";
