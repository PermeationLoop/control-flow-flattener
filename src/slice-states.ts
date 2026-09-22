import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { readFile } from "fs/promises";
import { hoistFunctionDeclarations, runCaptured } from "./hoist.js";
import { buildSlices, idOf } from "./slice.js";
import type { FNode, Slice } from "./slice.js";

const SAMPLE = `function order(flag) {
  console.log("start");
  let base = 10;
  if (flag > 1) {
    base = base + 5;
    console.log("big");
  } else if (flag === 1) {
    base = base * 2;
    console.log("one");
  } else {
    base = base - 1;
    console.log("small");
  }
  console.log("end", base);
  return base;
}
`;

// --- Annotated output: original + inert `__state = N` --------------------
// Runnable proof that the numbering preserves behavior (the assignments are
// inert: nothing reads __state yet — M4 turns the table into the machine).
const byId = new Map<number, Slice>();

function stateAssign(n: number): t.ExpressionStatement {
  return t.expressionStatement(
    t.assignmentExpression("=", t.identifier("__state"), t.numericLiteral(n))
  );
}

// appending __state assignment after each node
// for first-step observation
function annotate(nodes: FNode[]): t.Statement[] {
  let out: t.Statement[] = [
    t.variableDeclaration("let", [
      t.variableDeclarator(t.identifier("__state"), t.numericLiteral(0)),
    ]),
  ];
  const emit = (list: FNode[]): void => {
    for (const n of list) {
      if (n.kind === "stmts") {
        const slice = byId.get(idOf.get(n)!) as Extract<Slice, { kind: "seq" }>;
        out = out.concat(n.stmts);
        out.push(stateAssign(slice.next));
      } else if (n.kind === "if") {
        out.push(n.stmt); // whole if kept; branch targets live in the table
      } else if (n.kind === "while") {
        out.push(n.stmt);
      } else if (n.kind === "break") {
        const slice = byId.get(idOf.get(n)!) as Extract<Slice, { kind: "break" }>;
        out.push(n.stmt, stateAssign(slice.next));
      } else if (n.kind === "continue") {
        const slice = byId.get(idOf.get(n)!) as Extract<Slice, { kind: "continue" }>;
        out.push(n.stmt, stateAssign(slice.next));
      }
    }
  };
  emit(nodes);
  return out;
}

function printTable(slices: Slice[]): void {
  for (const s of [...slices].sort((a, b) => a.id - b.id)) {
    if (s.kind === "seq") {
      console.log(
        `  state ${s.id}: ${s.stmts.map((stmt) => generate(stmt).code.replace(/\s+/g, " ")).join(" ")}  → ${s.next}`
      );
    } else if (s.kind === "if") {
      console.log(
        `  state ${s.id}: if (${generate(s.test).code}) → ${s.nextTrue} else → ${s.nextFalse}   (merge ${s.merge})`
      );
    } else if (s.kind === "while") {
      console.log(
        `  state ${s.id}: while (${generate(s.test).code}) → ${s.nextBody}   (merge ${s.merge})`
      );
    } else if (s.kind === "break") {
      console.log(`  state ${s.id}: break → ${s.next}`);
    } else if (s.kind === "continue") {
      console.log(`  state ${s.id}: continue → ${s.next}`);
    }
  }
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

hoistFunctionDeclarations(fnPath); // M2 first: hoisted code is what gets sliced

const { top, slices, exit: EXIT_STATE } = buildSlices(fnPath);
for (const s of slices) byId.set(s.id, s);

const annotatedStmts = annotate(top);
fnPath.node.body.body = annotatedStmts;
const annotated = generate(ast).code;

console.log(`--- State table (${slices.length} slices, EXIT=${EXIT_STATE}) ---`);
printTable(slices);

if (inputFile) {
  console.log("--- Annotated ---");
  console.log(annotated);
} else {
  const args = [2, 1, 0];
  const results = args.map((a) => ({
    args: a,
    before: runCaptured(code, [a]),
    after: runCaptured(annotated, [a]),
  }));
  console.log("--- Output per input ---");
  for (const r of results) {
    console.log(
      `order(${r.args}): original=${JSON.stringify(r.before)} annotated=${JSON.stringify(r.after)} ${r.before === r.after ? "MATCH" : "MISMATCH"}`
    );
  }
  console.log("--- Annotated (runnable) ---");
  console.log(annotated);
}