// For-loop scoping: the loop var must NOT escape the loop. `typeof j` after
// the second loop must be "undefined" — hoisting `for (let ...)` to function
// scope turns it into "number" and this fails. Also: a loop var shadowing an
// outer `let i` (outer value must stay 100) and a loop var shadowing the
// parameter itself (param keeps its value).
function order(n = 0) {
  let i = 100;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total = total + i;
  }
  for (let j = 0; j < n; j++) {
    total = total + j;
  }
  let n2 = 0;
  for (let n = 0; n < 2; n++) {
    n2 = n2 + n;
  }
  // eval'd typeof: the loop-var must be OUT of scope here, so TS can't
  // resolve the name; a direct eval still sees a wrongly hoisted `var j`.
  console.log("outer", i, "leak-j", eval("typeof j"), "total", total, "param", n, "shadow-sum", n2);
  return total;
}