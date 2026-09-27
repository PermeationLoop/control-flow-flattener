// Baseline for: counter init/cond/update as one loop, per-iteration
// updates, two sequential loops reusing the loop-var name (sibling scopes,
// so both `let i` are legal), and zero-iteration input. A sliced for must
// evaluate cond once per iteration and keep the two loop bindings separate.
function order(n = 0) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  let acc = "";
  for (let i = 0; i < n; i++) {
    acc = acc + i + ";";
  }
  console.log("sum", sum, "acc", acc);
  return sum;
}