import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";

// --- Structure pass: a light CFG-ish tree --------------------------------
// One slice per statement; branches become explicit choices of the next
// state; plain blocks are transparent (their statements inline into the
// enclosing slice list); loops/switch/try stay ATOMIC — a single slice.
export type FNode =
  | { kind: "stmts"; stmts: t.Statement[]; parent: FNode | null }
  | { kind: "if"; stmt: t.IfStatement; test: t.Expression; con: FNode[]; alt: FNode[] | null; parent: FNode | null }
  | { kind: "while"; stmt: t.WhileStatement; test: t.Expression; body: FNode[]; parent: FNode | null }
  | { kind: "break"; stmt: t.BreakStatement; parent: FNode | null }
  | { kind: "continue"; stmt: t.ContinueStatement; parent: FNode | null }
  | { kind: "for"; stmt: t.ForStatement; test: t.Expression | null | undefined; update: t.Expression | null | undefined; body: FNode[]; updateBody: FNode[] | null; parent: FNode | null }

export type Slice =
  | { kind: "seq"; id: number; stmts: t.Statement[]; next: number }
  | {
    kind: "if";
    id: number;
    test: t.Expression;
    nextTrue: number;
    nextFalse: number;
    merge: number;
  }
  | {
    kind: "while";
    id: number;
    test: t.Expression;
    nextBody: number;
    merge: number;
  }
  | {
    kind: "for";
    id: number;
    test: t.Expression | null | undefined;
    update: t.Expression | null | undefined;
    nextBody: number;
    updateBody: number | null;
    merge: number;
  }
  | { kind: "break"; id: number; next: number }
  | { kind: "continue"; id: number; next: number };

function toList(s: t.Statement): t.Statement[] {
  return t.isBlockStatement(s) ? s.body : [s];
}

// Group several plain stmts together to be a slice.
// MUST mirror every branch buildNodes special-cases, or the lookahead
// would swallow such statements before they reach their handler — hiding
// break/continue in blocks (infinite loop in the machine) or bypassing
// the label rejection below.
function shouldAvoidGrouping(stmt: t.Statement): boolean {
  if (t.isIfStatement(stmt)) return true;
  if (t.isWhileStatement(stmt)) return true;
  if (t.isBreakStatement(stmt)) return true;
  if (t.isContinueStatement(stmt)) return true;
  if (t.isBlockStatement(stmt)) return true;
  if (t.isLabeledStatement(stmt)) return true;
  if (t.isForStatement(stmt)) return true;
  return false;
}

// Split statements into smaller units (nodes) for further processing.
function buildNodes(stmts: t.Statement[], parent: FNode | null): FNode[] {
  const MAX_GROUP_STMTS = 5;
  const nodes: FNode[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    if (t.isLabeledStatement(stmt)) {
      // A labeled break/continue targets a POSITION (end of the labeled
      // statement); the state table has no such concept, so wiring would
      // silently jump to the nearest enclosing while's merge. Fail loudly
      // instead of miscompiling.
      throw new TypeError("label syntax not supported: no state target for labeled break/continue");
    }
    if (t.isIfStatement(stmt)) {
      const ifNode: FNode = {
        kind: "if",
        stmt,
        test: stmt.test,
        con: null as unknown as FNode[],
        alt: null as unknown as FNode[],
        parent,
      };
      ifNode.con = buildNodes(toList(stmt.consequent), ifNode);
      ifNode.alt = stmt.alternate ? buildNodes(toList(stmt.alternate), ifNode) : null;
      nodes.push(ifNode);
    } else if (t.isForStatement(stmt)) {
      const forNode: FNode = {
        kind: "for",
        stmt,
        test: stmt.test,
        update: stmt.update,
        body: null as unknown as FNode[],
        updateBody: null as unknown as FNode[],
        parent
      }
      forNode.body = buildNodes(toList(stmt.body), forNode);
      if (forNode.update) {
        forNode.updateBody = buildNodes(toList(t.expressionStatement(forNode.update)), forNode)
      }
      nodes.push(forNode);
    } else if (t.isWhileStatement(stmt)) {
      const whileNode: FNode = {
        kind: "while",
        stmt,
        test: stmt.test,
        body: null as unknown as FNode[],
        parent,
      };
      whileNode.body = buildNodes(toList(stmt.body), whileNode);
      nodes.push(whileNode);
    } else if (t.isBreakStatement(stmt)) {
      nodes.push({ kind: "break", stmt, parent });
    } else if (t.isContinueStatement(stmt)) {
      nodes.push({ kind: "continue", stmt, parent });
    } else if (t.isBlockStatement(stmt)) {
      nodes.push(...buildNodes(stmt.body, parent)); // scope-only block: inline
    } else {
      // look ahead up to the max limit for stmt grouping
      const groupedStmts: t.Statement[] = [stmt];
      let ahead = 1;
      for (; ahead < MAX_GROUP_STMTS; ahead++) {
        if (i + ahead >= stmts.length) break;
        if (shouldAvoidGrouping(stmts[i + ahead])) break;
        groupedStmts.push(stmts[i + ahead]);
      }
      i = i + ahead - 1;
      nodes.push({ kind: "stmts", stmts: groupedStmts, parent });
    }
  }
  return nodes;
}

// --- Allocation pass: DFS state IDs --------------------------------------
// Depth-first allocation (test state, then consequent, then alternate, then
// the following sibling) numbers states in execution order, so the mapping
// reads naturally top to bottom. Module-scoped (reset per buildSlices call).
export const getIdOfNode = new Map<FNode, number>();

function assignIds(nodes: FNode[], getNext: () => number): void {
  for (const node of nodes) {
    getIdOfNode.set(node, getNext());
    if (node.kind === "if") {
      assignIds(node.con, getNext);
      if (node.alt) assignIds(node.alt, getNext);
    } else if (node.kind === "while") {
      assignIds(node.body, getNext);
    } else if (node.kind === "for") {
      assignIds(node.body, getNext);
      if (node.updateBody) assignIds(node.updateBody, getNext);
    }
  }
}

// --- Wiring pass: terminators --------------------------------------------
// Each statement slice ends in `__state = next`. An if slice is the test
// itself: `if (test) __state = A; else __state = B;`. Both branch chains
// converge on the if's `merge` — the id of the following sibling, or the
// function's EXIT state for the last statement.
export const slices: Slice[] = [];

function wire(nodes: FNode[], exit: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const next = i + 1 < nodes.length ? getIdOfNode.get(nodes[i + 1])! : exit;
    if (node.kind === "stmts") {
      slices.push({ kind: "seq", id: getIdOfNode.get(node)!, stmts: node.stmts, next });
    } else if (node.kind === "if") {
      slices.push({
        kind: "if",
        id: getIdOfNode.get(node)!,
        test: node.test,
        nextTrue: node.con.length > 0 ? getIdOfNode.get(node.con[0])! : next,
        nextFalse: node.alt && node.alt.length > 0 ? getIdOfNode.get(node.alt[0])! : next,
        merge: next,
      });
      wire(node.con, next);
      if (node.alt) wire(node.alt, next);
    } else if (node.kind === "while") {
      slices.push({
        kind: "while",
        id: getIdOfNode.get(node)!,
        test: node.test,
        nextBody: node.body.length > 0 ? getIdOfNode.get(node.body[0])! : getIdOfNode.get(node)!,
        merge: next,
      });
      wire(node.body, getIdOfNode.get(node)!);
    } else if (node.kind === "for") {
      slices.push({
        kind: "for",
        id: getIdOfNode.get(node)!,
        test: node.test,
        update: node.update,
        nextBody: node.body.length > 0 ? getIdOfNode.get(node.body[0])! : getIdOfNode.get(node.updateBody ? node.updateBody[0] : node)!,
        updateBody: node.updateBody && node.updateBody.length > 0 ? getIdOfNode.get(node.updateBody[0])! : getIdOfNode.get(node)!,
        merge: next,
      });
      wire(node.body, getIdOfNode.get(node.updateBody ? node.updateBody[0] : node)!);
      if (node.updateBody) wire(node.updateBody, getIdOfNode.get(node)!);
    } else if (node.kind === "break") {
      // find the merge of the parent while
      let parent: FNode | null = node.parent;
      while (parent !== null && parent.kind !== "while" && parent.kind !== "for") {
        parent = parent.parent;
      }
      if (parent === null) throw new TypeError("break outside loop");
      // parent must be while here; find its pushed slice (wire pushes the
      // while slice before descending into the body, so it always exists)
      const parentId = getIdOfNode.get(parent)!;
      const parentSlice = slices.find(
        (slice) => slice.id === parentId
      ) as Extract<Slice, { kind: "while" }> | Extract<Slice, { kind: "for" }>;
      if (!parentSlice) {
        throw new TypeError("break parent is not a while slice");
      }
      slices.push({ kind: "break", id: getIdOfNode.get(node)!, next: parentSlice.merge });
    } else if (node.kind === "continue") {
      // find the beginning (test state) of the parent while
      let parent: FNode | null = node.parent;
      while (parent !== null && parent.kind !== "while" && parent.kind !== "for") {
        parent = parent.parent;
      }
      if (parent === null) throw new TypeError("continue outside loop");
      if (parent.kind === "for" && parent.updateBody) {
        slices.push({ kind: "continue", id: getIdOfNode.get(node)!, next: getIdOfNode.get(parent.updateBody[0])! });
      } else {
        slices.push({ kind: "continue", id: getIdOfNode.get(node)!, next: getIdOfNode.get(parent)! });
      }
    } else {
      // unreachable: FNode is an exhaustive union
      const impossible: never = node;
      throw new TypeError(`Unsupported node type: ${impossible}`);
    }
  }
}

/**
 * Full slicing pipeline for one function: hoisted declarations are already
 * in place (call M2 first). Returns the slice table M3 prints and M4
 * compiles into the switch machine. Module-scoped maps are reset here so
 * repeated calls (or M3/M4 in one process) stay independent.
 */
export function buildSlices(fn: NodePath<t.Function>): {
  top: FNode[];
  slices: Slice[];
  entry: number
  exit: number;
} {
  const randomized = true;
  if (!t.isBlockStatement(fn.node.body)) {
    throw new TypeError("buildSlices expects a function with a block body");
  }
  getIdOfNode.clear();
  slices.length = 0;
  const top = buildNodes(fn.node.body.body, null);
  const { getNext, getFirstAssigned } = IdGenerator(randomized);
  assignIds(top, getNext);
  const exit = getNext();
  const entry = getFirstAssigned();
  wire(top, exit);
  const slicesResult = [...slices];
  if (randomized) slicesResult.sort(() => Math.random() - 0.5);
  return { top, slices: slicesResult, entry, exit };
}

function IdGenerator(randomized = true) {
  const idAssigned: number[] = [-1];
  const getRandomIntInclusive = (min: number, max: number) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };
  const getNext: () => number = () => {
    let choice: number;

    if (randomized) {
      do {
        choice = getRandomIntInclusive(0, 999999);
      } while (idAssigned.includes(choice))
    } else {
      choice = idAssigned[idAssigned.length - 1] + 1;
    }
    idAssigned.push(choice);
    return choice;
  }
  const getLast = () => {
    // not used maybe. Because EXIT needs a new id too.
    return idAssigned[idAssigned.length - 1];
  }
  const getFirstAssigned = () => {
    if (idAssigned.length === 1) throw TypeError("Didn't assign anything!");
    return idAssigned[1];
  }
  return { getNext, getFirstAssigned }
}