// Else-if chains, deep nesting, and conditions with side effects +
// short-circuit operators. Each condition must evaluate exactly once per
// decision, in order, and a matched else-if must skip the rest of the chain.
function order(n = 0) {
  console.log("start", n);
  let out = "";
  const log = (s: string): string => {
    out += s;
    console.log("pick", s, out.length);
    return s;
  };
  if (n > 10 && log("a") === "a") {
    if (n > 20) {
      out = log("B") + out;
    } else {
      out += log("b");
    }
  } else if (n > 5 || log("c") === "c") {
    out += log("C");
  } else if (n === 3) {
    out += log("three");
  }
  if (n === 0) {
    out += "zero";
  }
  console.log("out", out);
  return out;
}