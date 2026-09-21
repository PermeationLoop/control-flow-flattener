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
 * Rename every binding that shadows a same-named binding in an enclosing
 * scope to a fresh unique name, rewriting all its references.
 * Runs BEFORE hoisting: after hoisting, all declarations live in one flat
 * function scope, so shadowing names would collide. Renaming first keeps
 * each binding's identity intact.
 *
 * The `Scope` visitor fires for every nested scope (blocks, loops, nested
 * functions) under `fn` — but NOT for `fn` itself, whose bindings are the
 * root and cannot be shadowed. References track their binding via Babel's
 * scope analysis, so `scope.rename` rewrites declaration + every reference
 * atomically. Names are collected before mutating because rename() edits
 * `scope.bindings` while we iterate.
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

  fn.traverse({
    // FunctionDeclaration(path) {
    //   // NO NEED to convert because JS has function dclr hoisting and will be handled by scope rename
    //   // convert function xxxx () {} into let xxx = function () {} for hoisting
    //   const oldfunc = path.node;
    //   const id = oldfunc.id;  // I think the id should be defined here so no further check is performed
    //   if (!id) throw TypeError("Error in transforming function declaration");
    //   // create function expression
    //   const functionExpr = t.functionExpression (
    //     undefined, oldfunc.params, oldfunc.body, oldfunc.generator, oldfunc.async
    //   );
    //   const varDeclaration = t.variableDeclaration (
    //     "let", [t.variableDeclarator(
    //       id, functionExpr
    //     )]
    //   );
    //   path.replaceWith(varDeclaration);
    //   // and this path should be visited again and processed by the
    //   // variable declaration visitor.
    // },
    Function(path) {
      path.skip(); // this function's own locals are hoisted by its own pass
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

  if (unique.length === 0) return;
  const hoisted = t.variableDeclaration(
    "var",
    unique.map((n) => t.variableDeclarator(t.identifier(n)))
  );
  fn.node.body.body.unshift(hoisted);
}