// Milestone 4: compile the slice table into the real switch-state machine.
// `let __state = 0; while (__state !== EXIT) { switch (__state) { case N: … } }`
// — every node is constructed with @babel/types (no string codegen).
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { readFile, writeFile } from "fs/promises";
import { hoistFunctionDeclarations, runCaptured } from "./hoist.js";
import { buildSlices } from "./slice.js";
import type { Slice } from "./slice.js";

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

function stateAssign(n: number, stateName: string): t.ExpressionStatement {
  return t.expressionStatement(
    t.assignmentExpression("=", t.identifier(stateName), t.numericLiteral(n))
  );
}

// One SwitchCase per slice. The jump semantics:
//  - seq/if/while cases end with `__state = N;`  (plus the statement work)
//  - a `break` slice must write state BEFORE breaking the switch
//  - a `continue` slice writes state, then `continue` re-tests the loop
// The JS `break`/`continue` statements act on the ENCLOSING machine loop,
// which is exactly the control we want — no emulation needed.
function buildCase(s: Slice, stateName: string): t.SwitchCase {
  let consequent: t.Statement[];
  if (s.kind === "seq") {
    consequent = [...s.stmts, stateAssign(s.next, stateName)];
  } else if (s.kind === "if") {
    consequent = [
      t.ifStatement(
        t.cloneNode(s.test, true),
        stateAssign(s.nextTrue, stateName),
        stateAssign(s.nextFalse, stateName),
      ),
    ];
  } else if (s.kind === "while") {
    consequent = [
      t.ifStatement(
        t.cloneNode(s.test, true),
        stateAssign(s.nextBody, stateName),
        stateAssign(s.merge, stateName),
      ),
    ];
  } else if (s.kind === "break") {
    consequent = [stateAssign(s.next, stateName), t.breakStatement()];
  } else {
    consequent = [stateAssign(s.next, stateName), t.continueStatement()];
  }
  if (s.kind === "seq" || s.kind === "if" || s.kind === "while") {
    // exit the switch so the while loop re-reads __state — without this,
    // cases fall through and re-run the whole switch every pass
    consequent = [...consequent, t.breakStatement()];
  }
  return t.switchCase(t.numericLiteral(s.id), consequent);
}

// Replace the function body with the state machine. The hoisted `var`s are
// already inside slice 0 (state 0 executes them), so the body is only the
// state declaration plus the loop.
function buildMachine(slices: Slice[], exit: number): t.Statement[] {
  const stateName = "__state";
  const entry = t.variableDeclaration("let", [
    t.variableDeclarator(t.identifier(stateName), t.numericLiteral(0)),
  ]);
  const sw = t.switchStatement(
    t.identifier(stateName),
    slices.map((s) => buildCase(s, stateName))
  );
  const loop = t.whileStatement(
    t.binaryExpression("!==", t.identifier(stateName), t.numericLiteral(exit)),
    sw
  );
  return [entry, loop];
}

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

const { slices, exit } = buildSlices(fnPath);
fnPath.node.body.body = buildMachine(slices, exit);
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