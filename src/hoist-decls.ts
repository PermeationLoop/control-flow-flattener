import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { readFile, writeFile } from "fs/promises";

const SAMPLE = `function order() {
  console.log("start");
  let total = 0;
  const factor = 2;
  var tag = "T";
  const { a, b: renamed } = { a: 10, b: 20 };
  let [head, ...rest] = [1, 2, 3];
  {
    let step = 5;
    total = total + step * factor;
  }
  total = total + renamed + head + rest.length;
  console.log("done", tag + total);
  return tag + total;
}
`;

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
function collectPatternNames(pattern: t.Node, out: string[]): void {
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

function renameShadowedBindings(fn: NodePath<t.Function>): void {
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
function hoistFunctionDeclarations(fn: NodePath<t.Function>): void {
  if (!t.isBlockStatement(fn.node.body)) {
    return; // arrow with expression body: nothing to hoist into
  }

  renameShadowedBindings(fn);

  const names: string[] = [];

  fn.traverse({
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

function runCaptured(program: string): string {
  const lines: string[] = [];
  const consoleStub = {
    log: (...args: unknown[]) => lines.push(args.join(" ")),
  };
  new Function("console", `${program}\nreturn order();`)(consoleStub);
  return lines.join("\n");
}

// No file arg -> run the embedded sample and prove output equality.
// With file arg -> hoist every function in that file, write transformed.js.
const inputFile = process.argv[2];
const code = inputFile ? await readFile(inputFile, "utf-8") : SAMPLE;

const ast = parse(code);

traverse(ast, {
  Function(path) {
    hoistFunctionDeclarations(path);
  },
});

const transformed = generate(ast).code;

if (inputFile) {
  await writeFile("./transformed.js", transformed, { encoding: "utf-8" });
  console.log("--- Wrote transformed.js ---");
  console.log(transformed);
} else {

  console.log("--- Transformed ---");
  console.log(transformed);

}
const before = runCaptured(code);
const after = runCaptured(transformed); // also proves it parses + runs
console.log("--- Output ---");
console.log("original:    ", JSON.stringify(before));
console.log("transformed: ", JSON.stringify(after));
console.log(before === after ? "MATCH" : "MISMATCH");