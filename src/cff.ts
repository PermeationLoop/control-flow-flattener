// CLI for the control flow flattener. Supports JS and TypeScript input:
// TS files are transpiled to plain JS first (types stripped), then every
// function declaration is hoisted + flattened into a switch state machine.
// Output is always JS — `input.js` → `input-flattened.js`, `input.ts` →
// `input-flattened.js`.

import { readFile, writeFile } from "fs/promises";
import { exit } from "process";
import { parse as pathParse, extname } from "path";
import { flattenProgram } from "./lib/flatten.js";
import { isTypeScript } from "./lib/transpile-ts.js";

if (process.argv.length !== 3) {
	console.error("Usage: tsx cff.ts input.js|input.ts");
	exit(1);
}
const inputFile = process.argv[2];
const code = await readFile(inputFile, "utf-8");

const isTs = isTypeScript(inputFile);
if (isTs) console.log("[+] TypeScript input detected, transpiling to JS...");

const { output, functionCount } = flattenProgram(code, inputFile, console.log.bind(console));

const { name } = pathParse(inputFile);
const outExt = isTs ? ".js" : extname(inputFile) || ".js";
const outputFile = `${name}-flattened${outExt}`;

await writeFile(outputFile, output, { encoding: "utf-8" });
console.log(`[+] Wrote ${outputFile} (${functionCount} function(s) flattened)`);