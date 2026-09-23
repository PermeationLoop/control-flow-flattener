// Milestone 4: compile the slice table into the real switch-state machine.
// `let __state = 0; while (__state !== EXIT) { switch (__state) { case N: … } }`
// — every node is constructed with @babel/types (no string codegen).
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { readFile, writeFile } from "fs/promises";
import { hoistFunctionDeclarations, runCaptured } from "../lib/hoist.js";
import { buildSlices } from "../lib/slice.js";
import { buildMachine } from "../lib/state-machine.js";

const SAMPLE = `function order(limit = 5) {
  console.log("start");
  let i = 0;
  let sum = 0;
  while (i < limit) {
    i = i + 1;
    if (i % 2 === 0) {
      continue;
    }
    sum = sum + i;
  }
  console.log("odds", sum);
  if (sum > 3) {
    console.log("big");
  } else {
    console.log("small");
  }
  return sum;
}
`;


// --- Main -----------------------------------------------------------------
const inputFile = process.argv[2];
const code = inputFile ? await readFile(inputFile, "utf-8") : SAMPLE;

const ast = parse(code);

let fnPath: NodePath<t.FunctionDeclaration> | undefined;
traverse(ast, {
  FunctionDeclaration(path) {
    if (path.node.id?.name === "order") fnPath = path;
  },
});
if (!fnPath) throw new Error("target function 'order' not found");

hoistFunctionDeclarations(fnPath); // M2: hoisted code is what gets sliced

const { slices, entry, exit } = buildSlices(fnPath);
fnPath.node.body.body = buildMachine(slices, entry, exit);
const flattened = generate(ast).code;

if (inputFile) {
  await writeFile("./flattened.js", flattened, { encoding: "utf-8" });
  console.log("--- Wrote flattened.js ---");
  console.log(flattened);
} else {
  const args = [5, 0, 2];
  const results = args.map((a) => ({
    args: a,
    before: runCaptured(code, [a]),
    after: runCaptured(flattened, [a]),
  }));
  console.log("--- Output per input ---");
  for (const r of results) {
    console.log(
      `order(${r.args}): original=${JSON.stringify(r.before)} flattened=${JSON.stringify(r.after)} ${r.before === r.after ? "MATCH" : "MISMATCH"}`
    );
  }
  console.log(`--- Flattened machine (${slices.length} slices, EXIT=${exit}) ---`);
  console.log(flattened);
}