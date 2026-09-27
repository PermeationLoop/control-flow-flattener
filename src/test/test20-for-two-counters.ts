// For with two counters and non-trivial updates: a single update clause
// that is a sequence expression (`i++, j--`) — a sliced for must execute
// both in order — and a stride update (`m += 2`) that skips values. Also
// covers the empty-iteration boundary where init runs but cond is false.
function order(n = 0) {
  let log = "";
  for (let i = 0, j = n; i < j; i++, j--) {
    log = log + i + "-" + j + ";";
  }
  let k = 0;
  for (let m = 0; m < n; m += 2) {
    k = k + m;
  }
  console.log(log, k);
  return log + "|" + k;
}