// Exercise: grouping, while, continue (in if), nested while, break (in if).
function order(limit = 0) {
  console.log("start");
  let i = 0;
  let sum = 0;
  while (i < limit) {
    i = i + 1;
    if (i % 2 === 0) {
      continue;
    }
    sum = sum + i;
  }
  console.log("odds", sum);
  let j = 0;
  while (j < 3) {
    j = j + 1;
    let k = 0;
    while (k < 2) {
      k = k + 1;
      if (j * k > 2) {
        sum = sum + 10;
        break;
      }
    }
  }
  console.log("total", sum);
  return sum;
}