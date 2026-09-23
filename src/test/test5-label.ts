// Label syntax is intentionally UNSUPPORTED: buildNodes rejects any
// LabeledStatement with a TypeError before slicing (fail-fast, both modes).
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