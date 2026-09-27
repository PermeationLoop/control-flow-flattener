// For with early return and a side-effecting condition: `probes++` in the
// condition must run exactly once per iteration (it counts evaluations), the
// body can return before the loop finishes, and a fall-through return fires
// when the loop exits without a hit. A sliced for that caches or skips the
// condition miscounts `probes`.
function order(n = 0) {
  let probes = 0;
  let found = -1;
  let i = 0;
  for (; (probes++, i * 2) < n; i++) {
    if (i === n - 1) {
      found = i;
      break;
    }
    if (i > 3) {
      return "early:" + i + ":" + probes;
    }
  }
  console.log("found", found, "probes", probes);
  return found;
}