// A naive control flow flattening tool, only supports JS
// TS support on the roadmap

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { readFile, writeFile } from "fs/promises";
import { exit } from "process";
import { hoistFunctionDeclarations, runCaptured } from "./lib/hoist.js";
import { buildSlices } from "./lib/slice.js";
import { buildMachine } from "./lib/state-machine.js";
import { parse as pathParse } from "path";

if (process.argv.length !== 3) {
	console.error("Usage: tsx cff.ts input.js");
	exit(1);
}
const inputFile = process.argv[2];
const code = await readFile(inputFile, "utf-8");

const ast = parse(code);
console.log("[+] AST parsed");

let fnPathes: NodePath<t.FunctionDeclaration>[] = [];
traverse(ast, {
	FunctionDeclaration(path) {
		fnPathes.push(path);
	},
});
if (fnPathes.length === 0) throw new Error("No function in this file");
console.log(`[+] Function declaration count: ${fnPathes.length}, running hoisting...`);

fnPathes.forEach((fnPath) => hoistFunctionDeclarations(fnPath));
console.log(`[+] Hoisting finish, running flattener...`)

fnPathes.forEach((fnPath) => {
	const { slices, exit } = buildSlices(fnPath);
	fnPath.node.body.body = buildMachine(slices, exit);
});

console.log(`[+] Function processed count: ${fnPathes.length}, generating code...`);

const flattened = generate(ast).code;
const { name, ext } = pathParse(inputFile);
const outputFile = `${name}-flattened${ext}`;

await writeFile(outputFile, flattened, { encoding: "utf-8" });
console.log(`[+] Wrote ${outputFile}`);