// Params, type annotations, and every return shape: early returns, returns
// inside while/if, no-arg return. Multi-arg runs via the per-file
// `// test-args:` override.
// test-args: [[0, "x"], [3, "ab"], [7, ""], [-1, "x"]]
function order(count = 0, prefix = ""): string {
  console.log("in", count, JSON.stringify(prefix));
  if (count < 0) {
    return prefix + "neg";
  }
  let i = 0;
  let sum = "";
  while (i < count) {
    i = i + 1;
    if (i % 3 === 0) {
      return prefix + sum + "mod3";
    }
    if (prefix.length === 0) {
      return "noprefix";
    }
    sum = sum + prefix + i + ";";
    if (i === count) {
      return prefix + sum;
    }
  }
  return sum || "empty";
}