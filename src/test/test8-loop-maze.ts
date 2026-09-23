// Loop maze: while(true) with a conditional break, nested whiles whose
// break/continue must target the INNER loop, plus continue at the outer
// body level. Infinite-loop risk if a continue/break is wired to the wrong
// state.
function order(n = 0) {
  console.log("start", n);
  let i = 0;
  let total = 0;
  while (true) {
    i = i + 1;
    if (i > n) break;
    let j = 0;
    while (j < 3) {
      j = j + 1;
      if (j === 2) continue;
      total = total + i * j;
    }
    if (i % 2 === 0) continue;
    total = total + 100;
  }
  console.log("total", total);
  return total;
}