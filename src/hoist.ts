import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";

/**
 * Collect every binding name a destructuring pattern introduces, walking
 * the pattern tree recursively, and push them into `out`.
 *
 * WHY this exists: `let {a, b: renamed} = obj` declares TWO names. Hoisting
 * needs the complete name list (`var a, renamed;`), and the declaration→
 * assignment rewrite needs to keep the pattern itself in the LHS. So we must
 * find every bound name through arbitrary nesting, defaults, and rest.
 *
 * Pattern grammar this handles (each case either pushes a name and stops,
 * or descends one level and recurses — the tree is finite, so recursion
 * always terminates):
 *
 *   Identifier        `a`                      — leaf: push the name, stop
 *   AssignmentPattern `a = 5` / nested         — default value; the NAME is
 *                       `{a = 1}`, `[x = 1]`     always pattern.left
 *   RestElement       `...rest`                — name lives in .argument,
 *                                                 never in .argument's own
 *                                                 defaults
 *   ArrayPattern      `[a, b]`, `[, , c]`      — elements in order; holes
 *                                                 (null) are skipped
 *   ObjectPattern     `{a}` `{b: renamed}`     — every property's .value is
 *                    `{...rest}`                 itself a pattern; rest is
 *                                                 stored separately
 *
 * Anything else (`VoidPattern`, TS assertion patterns, plain expressions)
 * introduces no names — the type guards simply fall through and nothing is
 * pushed, which is correct.
 */
export function collectPatternNames(pattern: t.Node, out: string[]): void {
  // Leaf: a plain name binding.
  if (t.isIdentifier(pattern)) {
    out.push(pattern.name);
    return;
  }
  // Default value: `a = 5` — the bound name is `a`, the value is ignored.
  if (t.isAssignmentPattern(pattern)) {
    collectPatternNames(pattern.left, out);
    return;
  }
  // Rest element: `...rest` — descend into .argument (the bound pattern).
  if (t.isRestElement(pattern)) {
    collectPatternNames(pattern.argument, out);
    return;
  }
  // Array destructuring: every non-hole element is a pattern to recurse into.
  if (t.isArrayPattern(pattern)) {
    for (const el of pattern.elements) {
      if (el) collectPatternNames(el, out);
    }
    return;
  }
  // Object destructuring: each property's value is the bound pattern;
  // a rest property (`...rest`) is stored separately from normal properties.
  if (t.isObjectPattern(pattern)) {
    for (const prop of pattern.properties) {
      if (t.isRestElement(prop)) {
        collectPatternNames(prop.argument, out);
      } else if (t.isObjectProperty(prop)) {
        collectPatternNames(prop.value, out);
      }
    }
  }
}

/**
 * Rename every binding inside fn that shadows a same-named binding in an
 * enclosing scope, so hoisting can merge everything into one function-level
 * `var` without collisions and without rebinding references. Function names
 * are bindings too, so shadowed function declarations are handled here.
 *
 * Babel's scope API does the resolution work: `hasBinding` walks the parent
 * chain; `rename` rewrites the declaration and every reference that binds
 * to it. References are collected first, so mutating `scope.bindings` during
 * the rename loop is safe.
 */
export function renameShadowedBindings(fn: NodePath<t.Function>): void {
  fn.traverse({
    Scope(path) {
      const scope = path.scope;
      const shadowed = Object.keys(scope.bindings).filter((name) =>
        scope.parent?.hasBinding(name)
      );
      for (const name of shadowed) {
        scope.rename(name, scope.generateUid(name));
      }
    },
  });
}

/**
 * Hoist every eligible VariableDeclaration inside fn to the top of the
 * function body as a single uninitialized `var`, converting each inline
 * declaration into a plain assignment (or a destructuring assignment for
 * pattern declarators — `({ a } = obj);` needs no temporaries).
 *
 * Statement-position FunctionDeclarations are hoisted too, as intact nodes:
 * JS already hoists them at runtime, so moving them is a no-op for
 * function-body-level declarations — but the future state machine (M4) will
 * trap them inside case-arm blocks (strict-mode block scoping) or skip them
 * via branches, so they must sit at the very top before any if/loop.
 *
 * Exclusions (deliberate):
 *  - nested function scopes (their locals stay local — handled separately)
 *  - for / for-in / for-of loop headers (the loop needs its own binding)
 */
export function hoistFunctionDeclarations(fn: NodePath<t.Function>): void {
  if (!t.isBlockStatement(fn.node.body)) {
    return; // arrow with expression body: nothing to hoist into
  }

  renameShadowedBindings(fn);

  const names: string[] = [];
  const fnDecls: t.FunctionDeclaration[] = [];

  fn.traverse({
    Function(path) {
      path.skip(); // this function's own locals are hoisted by its own pass
    },
    FunctionDeclaration(path) {
      const parent = path.parentPath;
      fnDecls.push(path.node);
      if (
        parent.isIfStatement() ||
        parent.isWhileStatement() ||
        parent.isDoWhileStatement() ||
        parent.isForStatement() ||
        parent.isForInStatement() ||
        parent.isForOfStatement() ||
        parent.isLabeledStatement()
      ) {
        // Single-statement position (e.g. `if (x) function g(){}`): the
        // parent needs SOME statement — leave an empty one behind.
        path.replaceWith(t.emptyStatement());
      } else {
        path.remove();
      }
    },
    VariableDeclaration(path) {
      const parent = path.parentPath;
      if (
        parent.isForStatement() ||
        parent.isForInStatement() ||
        parent.isForOfStatement()
      ) {
        path.skip();
        return;
      }

      const statements: t.Statement[] = [];
      for (const declarator of path.node.declarations) {
        const id = declarator.id;
        const init = declarator.init;

        if (t.isIdentifier(id)) {
          names.push(id.name);
        } else if (t.isArrayPattern(id) || t.isObjectPattern(id)) {
          collectPatternNames(id, names);
        } else {
          continue; // VoidPattern / TS assertion patterns: not assignable
        }
        // Object/array patterns are valid LHS of assignment expressions:
        // `let {a} = obj;` becomes `({ a } = obj);` — native semantics.
        if (init) {
          statements.push(
            t.expressionStatement(t.assignmentExpression("=", id, init))
          );
        }
      }
      path.replaceWithMultiple(statements);
    },
  });

  // Dedupe runtime-collected names (dynamic membership, stable order).
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }

  if (fnDecls.length > 0) fn.node.body.body.unshift(...fnDecls);
  if (unique.length > 0) {
    const hoisted = t.variableDeclaration(
      "var",
      unique.map((n) => t.variableDeclarator(t.identifier(n)))
    );
    fn.node.body.body.unshift(hoisted);
  }
}

/**
 * Run `program` (which must declare `function order(...)`), stubbing
 * console.log, and return the captured output + return value as a string,
 * for comparing original vs transformed behavior.
 */
export function runCaptured(program: string, args: unknown[] = []): string {
  const lines: string[] = [];
  const consoleStub = {
    log: (...a: unknown[]) => lines.push(a.join(" ")),
  };
  const order = new Function("console", `${program}\nreturn order;`)(consoleStub);
  const result = order(...args);
  return `${JSON.stringify(result)} ${lines.join(" | ")}`;
}