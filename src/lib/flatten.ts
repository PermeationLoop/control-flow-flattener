// Shared flatten pipeline, reusable by both the CLI (cff.ts) and the test
// harness (src/test/run.ts). TypeScript input is transpiled to plain JS
// first (types stripped via the `typescript` compiler's transpileModule —
// the same transpile-only strategy tsx uses), then the existing hoist +
// slice + state-machine passes run on the JS.
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import { transformSync, type PresetItem } from "@babel/core";
import presetTs from "@babel/preset-typescript";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { hoistFunctionDeclarations } from "./hoist.js";
import { buildSlices } from "./slice.js";
import { buildMachine } from "./state-machine.js";

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"];

/** True when the filename marks a TypeScript source. */
export function isTypeScript(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TS_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * Compile TypeScript `code` to plain JS via @babel/preset-typescript — the
 * standard Babel TS→JS transform: type annotations, interfaces, type
 * aliases and generics are erased; enums become runtime objects. Syntax
 * errors are fatal; type errors are ignored (transpile-only, like tsx).
 */
export function transpileTs(code: string, filename = "input.ts"): string {
  // Babel 8 types PresetItem's options as `object`, while preset-typescript
  // declares its own Options interface — contravariantly incompatible for
  // the options-less form. We pass no options, so bridge the declaration.
  const stripTypes: PresetItem = presetTs as unknown as PresetItem;
  const result = transformSync(code, {
    filename,
    presets: [stripTypes],
    configFile: false,
    babelrc: false,
    ast: false,
  });
  if (!result?.code) throw new Error("TypeScript transpile produced no output");
  return result.code;
}

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
    const { slices, exit } = buildSlices(fnPath);
    fnPath.node.body.body = buildMachine(slices, exit);
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