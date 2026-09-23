// Shared flatten pipeline, reusable by both the CLI (cff.ts) and the test
// harness (src/test/run.ts). TypeScript input is transpiled to plain JS
// first (types stripped via the `typescript` compiler's transpileModule —
// the same transpile-only strategy tsx uses), then the existing hoist +
// slice + state-machine passes run on the JS.
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import { transpileTs, isTypeScript } from "./transpile-ts.js";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { hoistFunctionDeclarations } from "./hoist.js";
import { buildSlices } from "./slice.js";
import { buildMachine } from "./state-machine.js";



export interface FlattenResult {
  /** The flattened program text (always pure JS). */
  output: string;
  /** Number of function declarations flattened. */
  functionCount: number;
}

/**
 * Full pipeline: (transpile TS if `filename` says so) → parse → hoist every
 * function declaration's vars/decls → slice each function → rebuild each
 * body as the switch state machine → regenerate.
 *
 * `log` is optional console-style progress reporting; the CLI passes
 * console.log, the test harness passes nothing (it wants silent output).
 */
export function flattenProgram(
  code: string,
  filename: string,
  log: (msg: string) => void = () => {}
): FlattenResult {
  const source = isTypeScript(filename) ? transpileTs(code) : code;

  const ast = parse(source, { sourceType: "module" });
  log("[+] AST parsed");

  const fnPathes: NodePath<t.FunctionDeclaration>[] = [];
  traverse(ast, {
    FunctionDeclaration(path) {
      fnPathes.push(path);
    },
  });
  if (fnPathes.length === 0) throw new Error("No function in this file");
  log(`[+] Function declaration count: ${fnPathes.length}, running hoisting...`);

  // Hoisting an enclosing function DETACHES its nested declarations (moves
  // them to the top of its body), which nulls the held paths below. So hoist
  // deepest-first: nested functions are prepared before their parent moves
  // them, then the flatten pass re-collects fresh paths from the new tree.
  fnPathes.sort((a, b) => fnDepth(b) - fnDepth(a));
  for (const fnPath of fnPathes) hoistFunctionDeclarations(fnPath);
  log("[+] Hoisting finish, running flattener...");

  const toFlatten: NodePath<t.FunctionDeclaration>[] = [];
  traverse(ast, {
    FunctionDeclaration(path) {
      toFlatten.push(path);
    },
  });
  for (const fnPath of toFlatten) {
    const { slices, entry, exit } = buildSlices(fnPath);
    fnPath.node.body.body = buildMachine(slices, entry, exit);
  }

  log(`[+] Function processed count: ${toFlatten.length}, generating code...`);

  return { output: generate(ast).code, functionCount: toFlatten.length };
}

/** Number of enclosing function declarations (nesting depth in the fn tree). */
function fnDepth(path: NodePath<t.FunctionDeclaration>): number {
  let depth = 0;
  let parent: NodePath | null = path.parentPath;
  while (parent) {
    if (parent.isFunctionDeclaration()) depth++;
    parent = parent.parentPath;
  }
  return depth;
}