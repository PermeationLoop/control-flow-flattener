// Nested for: an inner loop whose continue (skip the diagonal) and break
// (stop after two digits) must target the INNER loop only, while the outer
// loop continues. Confuses any impl that flattens break/continue onto the
// nearest sliced loop without tracking depth.
function order(n = 0) {
  let out = "";
  for (let i = 0; i < n; i++) {
    let row = "";
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      row = row + j;
      if (row.length >= 2) break;
    }
    out = out + "[" + row + "]";
  }
  console.log(out);
  return out;
}