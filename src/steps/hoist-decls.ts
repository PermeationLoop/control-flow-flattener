// this code test hoisting the declaration of a function called "order"
// and test if the execution result matches the origin one

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import { readFile, writeFile } from "fs/promises";
import { hoistFunctionDeclarations, runCaptured } from "../lib/hoist.js";

const SAMPLE = `function order() {
  console.log("start");
  let total = 0;
  const factor = 2;
  var tag = "T";
  const { a, b: renamed } = { a: 10, b: 20 };
  let [head, ...rest] = [1, 2, 3];
  function inline() { return tag + total; }
  {
    let step = 5;
    total = total + step * factor;
    function blocked() { return "blocked"; }
    console.log("blocked says", blocked());
  }
  total = total + renamed + head + rest.length + inline().length;
  console.log("done", tag + total);
  return tag + total;
}
`;

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