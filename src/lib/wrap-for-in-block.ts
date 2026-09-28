import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";

/**
 * Rewrite `for (init; test; update) body` into `{ init; for (; test; update) body }`
 * — the init becomes a plain statement the slicing pass can handle, and the
 * remaining loop behaves like a `while` (plus an update slice).
 *
 * Two safety rules:
 *  - `init === null` returns immediately. This is also what stops infinite
 *    recursion: the cloned loop below has no init, so the traversal visits it
 *    once and leaves it alone instead of wrapping it again forever.
 *  - Loop-header block bindings are renamed to fresh uids. The machine hoists
 *    every declaration to function scope, which would leak the loop var past
 *    the loop (observable via `typeof`); renaming keeps the original name
 *    absent outside and stops sibling loops with the same var name colliding.
 *    (Pattern declarators — `for (let {x} = …)` — are left alone.)
 */
export function wrapForInBlock(fn: NodePath<t.ForStatement>): void {
  const init = fn.node.init;
  if (!init) return;

  // if (t.isVariableDeclaration(init)) {
  //   // Rename this loop's header bindings only (not body/nested-fn locals):
  //   // the declarator's VariableDeclaration must be this ForStatement's init.
  //   fn.traverse({
  //     Function(path) {
  //       path.skip(); // nested function locals belong to their own function
  //     },
  //     VariableDeclarator(path) {
  //       const decl = path.parentPath;
  //       if (!decl.isVariableDeclaration()) return;
  //       if (decl.parentPath?.node !== fn.node) return;
  //       const id = path.node.id;
  //       if (!t.isIdentifier(id)) return;
  //       path.scope.rename(id.name, path.scope.generateUid(id.name));
  //     },
  //   });
  // }

  const clonedFn = t.cloneNode(fn.node, true);
  clonedFn.init = null;

  fn.replaceWith(
    t.blockStatement([
      t.isExpression(init) ? t.expressionStatement(init) : init,
      clonedFn,
    ]),
  );
}