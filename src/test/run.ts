// Behavioral test harness for the flattener.
//
// For every test file in this directory that declares `function order(...)`:
//   1. original  — the source (TypeScript transpiled to JS, types stripped)
//   2. processed — the same file run through the flatten pipeline
// ...are executed with stubbed console.log via runCaptured, and their
// console.log history + return value are compared (equal JSON + joined log
// lines must match exactly). Throwing in both is a match; throwing in one
// is a mismatch. Files without an `order` function are skipped (the tool
// requires at least one function declaration; runCaptured keys on `order`).
//
// Argument sets per file: an optional header comment overrides the default
// matrix —
//   // test-args: [[0, 1], [5, 2]]
// (JSON array of argument tuples). No comment → DEFAULT_ARGS.

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { flattenProgram, transpileTs } from "../lib/flatten.js";
import { runCaptured } from "../lib/hoist.js";

const TEST_DIR = new URL(".", import.meta.url).pathname;

// Default argument tuples exercised for every test file. Files that ignore
// args produce identical runs for each tuple; cheap and harmless.
const DEFAULT_ARGS: unknown[][] = [[], [0], [1], [2], [5], [10]];

/** Parse the `// test-args: [[...]]` header, or null when absent. */
function parseArgsOverride(source: string): unknown[][] | null {
  const m = source.match(/\/\/\s*test-args:\s*(\[.*\])/);
  if (!m) return null;
  return JSON.parse(m[1]) as unknown[][];
}

type Capture = { ok: true; value: string } | { ok: false; error: string };

function capture(program: string, args: unknown[]): Capture {
  try {
    return { ok: true, value: runCaptured(program, args) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const entries = (await readdir(TEST_DIR))
  .filter((f) => f !== "run.ts" && (f.endsWith(".ts") || f.endsWith(".js")))
  .sort();
const files = [];
for (const f of entries) {
  const source = await readFile(join(TEST_DIR, f), "utf-8");
  // Contract-excluded features (e.g. labels) are fixtures asserting the
  // fail-fast error, not comparable programs — skip them.
  if (/\/\/\s*unsupported:/.test(source)) continue;
  files.push({ file: f, source });
}

let failures = 0;
let compared = 0;
let skipped = 0;

for (const { file, source } of files) {
  const isTs = file.endsWith(".ts");
  const isTestTarget = /\bfunction\s+order\b/.test(source);
  if (!isTestTarget) {
    skipped++;
    console.log(`skip  ${file} (no 'function order' — not flattenable by contract)`);
    continue;
  }

  let originalJs: string;
  let processed: string;
  try {
    originalJs = isTs ? transpileTs(source) : source;
    processed = flattenProgram(source, file).output;
  } catch (e) {
    failures++;
    console.error(`FAIL  ${file}: pipeline threw: ${e instanceof Error ? e.message : e}`);
    continue;
  }

  const argsList = parseArgsOverride(source) ?? DEFAULT_ARGS;
  const runs: { args: unknown[]; same: boolean; before: Capture; after: Capture }[] = [];

  for (const args of argsList) {
    const before = capture(originalJs, args);
    const after = capture(processed, args);
    // Single discriminant read per side — TS7's native checker misses
    // narrowing when the same discriminant is re-checked in one expression.
    const same =
      (before.ok ? "ok:" + before.value : "threw:" + before.error) ===
      (after.ok ? "ok:" + after.value : "threw:" + after.error);
    compared++;
    runs.push({ args, same, before, after });
    if (same) continue;
    failures++;
    console.error(`MISMATCH ${file} order(${JSON.stringify(args)})`);
    if (before.ok) {
      console.error(`  original   → ${before.value}`);
    } else {
      console.error(`  original   → threw: ${before.error}`);
    }
    if (after.ok) {
      console.error(`  flattened  → ${after.value}`);
    } else {
      console.error(`  flattened  → threw: ${after.error}`);
    }
  }

  if (runs.every((r) => r.same)) {
    console.log(`ok     ${file} (${runs.length} arg set(s))`);
  }
}

console.log(
  `\n${compared} comparison(s), ${failures} failure(s), ${skipped} skipped file(s).`
);
process.exitCode = failures > 0 ? 1 : 0;