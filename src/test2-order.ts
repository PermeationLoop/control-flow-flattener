function order() {
  console.log("start");
  let total = 0;
  const factor = 2;
  var tag = "T";
	let o1 = "object1";
	let o2 = "object2";
	let arr = ["actual1", "actual2"];
  function inner () {
    let step = 5;
		let total = 4;
    total = total + step * factor + 1;
		console.log("done", tag + total);
		let [o1, o2] = arr;
		console.log(o1, o2);
  }
	inner ();
	console.log(o1, o2);
  total = total + 1;
  console.log("done", tag + total);
  return tag + total;
}