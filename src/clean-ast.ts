import type { ParseResult } from "@babel/parser";

/**
 * Deep-clone a Babel AST and strip position metadata (`start`, `end`, `loc`)
 * from every node and comment, for readable JSON debugging output.
 * The input AST is left untouched — positions survive for later codegen/sourcemaps.
 */
export default function cleanAst(input: ParseResult): ParseResult {
	const output = structuredClone(input);
	stripPositions(output);
	return output;
}

function stripPositions(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			stripPositions(item);
		}
		return;
	}
	if (value === null || typeof value !== "object") {
		return;
	}

	const obj = value as Record<string, unknown>;
	if (typeof obj.type === "string") {
		delete obj.start;
		delete obj.end;
		delete obj.loc;
	}
	for (const key of Object.keys(obj)) {
		stripPositions(obj[key]);
	}
}