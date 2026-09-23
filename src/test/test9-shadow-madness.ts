// Shadowing chaos: block-level and nested declarations collide with outer
// names; the rename pass must keep every reference on the right binding
// while hoisting merges everything into one function-level var. Also covers
// single-statement-position function declarations (hoisted out of the if)
// and destructuring with defaults, holes and rest.
function order(flag = 1) {
  const tag = "outer";
  let x = "X0";
  let sum = 0;
  if (flag) {
    const tag = "inner-block";
    let x = 1;
    function bump() {
      console.log(x, tag);
      return x + 1;
    }
    x = bump();
    sum = sum + x;
    console.log("block", tag, x);
  }
  let { a, b: renamed = 3 } = { a: 10, b: 7 };
  let [first, , ...rest] = [1, 2, 3, 4, 5];
  console.log("destr", a, renamed, first, rest.join("+"));
  console.log("final", tag, x);
  return sum > 0 ? `${tag}:${sum}` : "none";
}