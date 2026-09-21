import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { readFile } from "fs/promises";
import { hoistFunctionDeclarations, runCaptured } from "./hoist.js";

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

// --- Structure pass: a light CFG-ish tree --------------------------------
// One slice per statement; branches become explicit choices of the next
// state; plain blocks are transparent (their statements inline into the
// enclosing slice list); loops/switch/try stay ATOMIC — a single slice.
type FNode =
  | { kind: "stmts"; stmts: t.Statement[]; parent: FNode | null }
  | { kind: "if"; stmt: t.IfStatement; test: t.Expression; con: FNode[]; alt: FNode[] | null; parent: FNode | null }
  | { kind: "while"; stmt: t.WhileStatement; test: t.Expression; body: FNode[]; parent: FNode | null }
  | { kind: "break"; stmt: t.BreakStatement; parent: FNode | null }
  | { kind: "continue"; stmt: t.ContinueStatement; parent: FNode | null }
  | { kind: "unknown"; parent: FNode | null };

type Slice =
  | { kind: "seq"; id: number; stmts: t.Statement[]; next: number }
  | {
    kind: "if";
    id: number;
    test: t.Expression;
    nextTrue: number;
    nextFalse: number;
    merge: number; // where both branches converge
  }
  | {
    kind: "while";
    id: number;
    test: t.Expression;
    nextBody: number;
    merge: number;
  }
  | {
    kind: "break";
    id: number;
    next: number;
  }
  | {
    kind: "continue";
    id: number;
    next: number;
  };

function toList(s: t.Statement): t.Statement[] {
  return t.isBlockStatement(s) ? s.body : [s];
}

// group several plain stmts together to be a slice
function shouldAvoidGrouping(stmt: t.Statement): boolean {
  if (t.isIfStatement(stmt)) return true;
  if (t.isWhileStatement(stmt)) return true;
  if (t.isBreakStatement(stmt)) return true;
  if (t.isContinueStatement(stmt)) return true;
  if (t.isBlockStatement(stmt)) return true;
  if (t.isLabeledStatement(stmt)) return true; // must reach the rejection guard
  return false;
}

// Split statements into smaller units (nodes)
// for further process
function buildNodes(stmts: t.Statement[], parent: FNode | null): FNode[] {
  const MAX_GROUP_STMTS = 5;
  const nodes: FNode[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    if (t.isLabeledStatement(stmt)) {
      // A labeled break/continue targets a POSITION (end of the labeled
      // statement); the state table has no such concept, so wiring would
      // silently jump to the nearest enclosing while's merge. Fail loudly
      // instead of miscompiling. (Labeled statements are otherwise atomic,
      // which is exactly why this is an explicit boundary, not a rule.)
      throw new TypeError("label syntax not supported: no state target for labeled break/continue");
    }
    if (t.isIfStatement(stmt)) {
      const ifNode: FNode = {
        kind: "if",
        stmt,
        test: stmt.test,
        con: null as unknown as FNode[],
        alt: null as unknown as FNode[],
        parent
      }
      ifNode.con = buildNodes(toList(stmt.consequent), ifNode)
      ifNode.alt = stmt.alternate ? buildNodes(toList(stmt.alternate), ifNode) : null,
        nodes.push(ifNode);
    } else if (t.isWhileStatement(stmt)) {
      const whileNode: FNode = {
        kind: "while",
        stmt,
        test: stmt.test,
        body: null as unknown as FNode[],
        parent
      }
      whileNode.body = buildNodes(toList(stmt.body), whileNode);
      nodes.push(whileNode);
    } else if (t.isBreakStatement(stmt)) {
      nodes.push({
        kind: "break",
        stmt,
        parent
      })
    } else if (t.isContinueStatement(stmt)) {
      nodes.push({
        kind: "continue",
        stmt,
        parent
      })
    } else if (t.isBlockStatement(stmt)) {
      nodes.push(...buildNodes(stmt.body, parent)); // scope-only block: inline
    } else {
      // look ahead up to the max limit for stmt grouping
      const grouped_stmts: t.Statement[] = [stmt];
      let ahead = 1
      for (; ahead < MAX_GROUP_STMTS; ahead++) {
        if (i + ahead >= stmts.length) break;
        if (shouldAvoidGrouping(stmts[i + ahead])) break;
        grouped_stmts.push(stmts[i + ahead]);
      }
      i = i + ahead - 1;
      nodes.push({ kind: "stmts", stmts: grouped_stmts, parent });
    }
  }
  return nodes;
}

// --- Allocation pass: DFS state IDs --------------------------------------
// Depth-first allocation (test state, then consequent, then alternate, then
// the following sibling) numbers states in execution order, so the mapping
// reads naturally top to bottom.
const idOf = new Map<FNode, number>();

function assignIds(nodes: FNode[], counter: { value: number }): void {
  for (const node of nodes) {
    idOf.set(node, counter.value++);
    if (node.kind === "if") {
      assignIds(node.con, counter);
      if (node.alt) assignIds(node.alt, counter);
    } else if (node.kind === "while") {
      assignIds(node.body, counter);
    }
  }
}

// --- Wiring pass: terminators --------------------------------------------
// Each statement slice ends in `__state = next`. An if slice is the test
// itself: `if (test) __state = A; else __state = B;`. Both branch chains
// converge on the if's `merge` — the id of the following sibling, or the
// function's EXIT state for the last statement.
const slices: Slice[] = [];

function wire(nodes: FNode[], exit: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const next = i + 1 < nodes.length ? idOf.get(nodes[i + 1])! : exit;
    if (node.kind === "stmts") {
      slices.push({ kind: "seq", id: idOf.get(node)!, stmts: node.stmts, next });
    } else if (node.kind === "if") {
      slices.push({
        kind: "if",
        id: idOf.get(node)!,
        test: node.test,
        nextTrue: node.con.length > 0 ? idOf.get(node.con[0])! : next,
        nextFalse: node.alt && node.alt.length > 0 ? idOf.get(node.alt[0])! : next,
        merge: next,
      });
      wire(node.con, next);
      if (node.alt) wire(node.alt, next);
    } else if (node.kind === "while") {
      slices.push({
        kind: "while",
        id: idOf.get(node)!,
        test: node.test,
        nextBody: node.body.length > 0 ? idOf.get(node.body[0])! : idOf.get(node)!,
        merge: next,
      })
      wire(node.body, idOf.get(node)!);
    } else if (node.kind === "break") {
      // find the merge of the parent while
      let parent: FNode | null = node.parent;
      while (parent !== null && parent.kind !== "while") {
        parent = parent.parent;
      }
      if (parent === null) throw TypeError("Break - parent 過於惡俗！");
      // parent must be while here
      // find the next node of the parent
      const parentId = idOf.get(parent)!;
      const parentSlice = slices.find((slice) => slice.id === parentId) as Extract<Slice, { kind: "while" }>;
      if (!parentSlice || parentSlice.kind !== "while") throw TypeError("Break - parent slice 過於惡俗！");
      slices.push({
        kind: "break",
        id: idOf.get(node)!,
        next: parentSlice.merge,
      })
    } else if (node.kind === "continue") {
      // find the beginning of the parent while
      let parent: FNode | null = node.parent;
      while (parent !== null && parent.kind !== "while") {
        parent = parent.parent;
      }
      if (parent === null) throw TypeError("Continue - parent 過於惡俗！");
      // parent must be while here
      slices.push({
        kind: "continue",
        id: idOf.get(node)!,
        next: idOf.get(parent)!,
      })
    } else {
      throw TypeError(`Unsupported node type: ${node.kind}`);
    }
  }
}

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

function printTable(): void {
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
      console.log(
        `  state ${s.id}: break → ${s.next}`
      );
    } else if (s.kind === "continue") {
      console.log(
        `  state ${s.id}: continue → ${s.next}`
      );
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

const top = buildNodes(fnPath.node.body.body, null);
const counter = { value: 0 };
assignIds(top, counter);
const EXIT_STATE = counter.value;
wire(top, EXIT_STATE);
for (const s of slices) byId.set(s.id, s);

const annotatedStmts = annotate(top);
fnPath.node.body.body = annotatedStmts;
const annotated = generate(ast).code;

console.log(`--- State table (${slices.length} slices, EXIT=${EXIT_STATE}) ---`);
printTable();

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