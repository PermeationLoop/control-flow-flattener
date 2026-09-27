// For with break and continue: continue on even counters, a break on the
// last iteration (body never runs for it), a threshold break mid-loop, and
// a second countdown loop whose first iteration is skipped via continue.
// Wire the wrong break/continue target and the totals change.
function order(n = 0) {
  let taken = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) break;
    if (i % 2 === 0) continue;
    taken = taken + i;
    if (taken >= n) break;
  }
  let skipped = 0;
  for (let k = n; k > 0; k--) {
    if (k === n && n > 3) continue;
    skipped = skipped + 1;
  }
  console.log("taken", taken, "skipped", skipped);
  return taken;
}