// Shadowing test for the rename + function-declaration hoisting passes.
// The block-level `function localFn` shadows the outer `let localFn`; the
// rename pass must give it a fresh name, and hoisting must lift it above
// the `if` so branch flow can't skip its declaration.
function order(flag = 1) {
  let localFn = "outer-var";
  console.log("start");
  if (flag) {
    const innervar = "innervar";
    function localFn() { return innervar + "inner-fn"; }
    console.log("branch", localFn());
  }
  console.log("end", localFn);
  return localFn;
}