function order(flag) {
  console.log("start");
  let base = 10;
  if (flag > 1) {
    base = base + 5;
    base = base + 6;
    base = base + 7;
    base = base + 8;
    base = base + 9;
    base = base + 0;
    base = base + 1;
    base = base + 5;
    console.log("big");
  } else if (flag === 1) {
    base = base * 2;
    console.log("one");
  } else {
    base = base - 1;
    while (base > 0) {
      base -= 0.01;
      base -= 0.01;
      base -= 0.01;
      base -= 0.01;
      if (base > 3) {
        if (base > 4) continue;
        else break;
      }
      base -= 0.01;
      base -= 0.01;
      base -= 0.01;
      base -= 0.01;
      base -= 0.01;
      base -= 0.01;
    }
    console.log("small");
  }
  console.log("end", base);
  return base;
}