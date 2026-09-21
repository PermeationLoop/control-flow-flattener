// Regression: the grouping lookahead must NOT swallow a block containing
// break/continue — such statements need their own states or the machine
// would turn the break into a switch-break (infinite loop).
function order(n = 0) {
  let i = 0;
  while (i < n) {
    i = i + 1;
    { break; }
  }
  return i;
}