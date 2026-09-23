// Inner function declarations are flattened too; they close over hoisted
// outer vars, and recursion (direct and mutual) re-enters a fresh state
// machine on every call.
function order(n = 0) {
  console.log("enter", n);
  let acc = 0;
  function step(k: number): number {
    acc = acc + k;
    if (k <= 0) return acc;
    return step(k - 1);
  }
  const res = step(n);
  console.log("acc", acc);

  let log = "";
  function a(k: number): number {
    log += "a";
    if (k <= 0) {
      console.log(log);
      return 0;
    }
    return b(k - 1);
  }
  function b(k: number): number {
    log += "b";
    if (k <= 0) {
      console.log(log);
      return 1;
    }
    return a(k - 1);
  }
  const res2 = n % 2 === 0 ? a(n) : b(n);
  console.log("res", res2, log);
  return res + res2;
}