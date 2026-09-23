import { transformSync, type PresetItem } from "@babel/core";
import presetTs from "@babel/preset-typescript";

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"];

/** True when the filename marks a TypeScript source. */
export function isTypeScript(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TS_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * Compile TypeScript `code` to plain JS via @babel/preset-typescript — the
 * standard Babel TS→JS transform: type annotations, interfaces, type
 * aliases and generics are erased; enums become runtime objects. Syntax
 * errors are fatal; type errors are ignored (transpile-only, like tsx).
 */
export function transpileTs(code: string, filename = "input.ts"): string {
  // Babel 8 types PresetItem's options as `object`, while preset-typescript
  // declares its own Options interface — contravariantly incompatible for
  // the options-less form. We pass no options, so bridge the declaration.
  const stripTypes: PresetItem = presetTs as unknown as PresetItem;
  const result = transformSync(code, {
    filename,
    presets: [stripTypes],
    configFile: false,
    babelrc: false,
    ast: false,
  });
  if (!result?.code) throw new Error("TypeScript transpile produced no output");
  return result.code;
}