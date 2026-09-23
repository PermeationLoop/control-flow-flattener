// Label syntax is intentionally UNSUPPORTED: buildNodes rejects any
// LabeledStatement with a TypeError before slicing (fail-fast, both modes).
// unsupported: labels — the harness skips files asserting a fail-fast error.
function order(n = 0) {
  let i = 0;
  outer: while (i < n) {
    i = i + 1;
    if (i > 2) {
      break outer;
    }
  }
  return i;
}