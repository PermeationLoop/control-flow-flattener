import { writeFileSync } from "fs";

function calcPlus10(n: number) {
  console.log("開始計算 n + 10...");
  n = n + 1;
  n = n + 2;
  console.log("完成了一半力...");
  n = n + 3;
  n = n + 4;
  console.log("結果是", n);
  writeFileSync("./result.md", "結果是" + n);
}

function calcPlus102(n: number) {
  let __step = 0;
  while (__step !== 3) {
    switch (__step) {
      case 0:
        console.log("開始計算 n + 10...");
        n = n + 1;
        n = n + 2;
        __step = 1;
        break;
      case 1:
        console.log("完成了一半力...");
        n = n + 3;
        n = n + 4;
        __step = 2;
        break;
      case 2:
        console.log("結果是", n);
        writeFileSync("./result.md", "結果是 " + n)
        __step = 3;
        break;
    }
  }
}

calcPlus10(20);
calcPlus102(20);