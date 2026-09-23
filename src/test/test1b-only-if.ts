// test-args: [[0], [1]]
function order(flag: number): string {
	console.log({ flag });
	if (flag) {
		console.log("yes");
		return "yes";
	} else {
		console.log("no");
		return "no";
	}
}