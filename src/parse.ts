import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import { readFile, writeFile } from 'fs/promises';
import cleanAst from "./clean-ast.js";

const args: string[] = process.argv.slice(2);
const astOutput = "./ast.json";

const code = await readFile(args[0], {
  encoding: "utf-8"
});

// 1. PARSE: source string -> File AST
const ast = parse(code);
console.log("--- AST written---");
await writeFile(astOutput, JSON.stringify(cleanAst(ast), null, 2), {
  encoding: "utf-8"
});


// 2. TRAVERSE: walk every node; log Statement node types, indented by depth
console.log("--- Statements in traversal order ---");
traverse(ast, {
  Statement(path) {
    console.log(`${"  ".repeat(path.getAncestry().length - 1)}${path.node.type}`);
  },
});

// 3. GENERATE: AST back to source text
const output = generate(ast).code;
console.log("--- Regenerated code ---");
console.log(output);