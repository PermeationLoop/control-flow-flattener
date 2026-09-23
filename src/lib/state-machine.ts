// `let __state = 0; while (__state !== EXIT) { switch (__state) { case N: … } }`
// — every node is constructed with @babel/types (no string codegen).
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type { Slice } from "./slice.js";


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
export function buildMachine(slices: Slice[], exit: number): t.Statement[] {
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
