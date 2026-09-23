// State churn: long plain statement runs (slice grouping caps at 5 stmts,
// so a long run forces several seq slices) interleaved with many
// consecutive ifs (one state each). Exercises dense wiring and ID order.
function order(n = 0) {
  let s = n;
  let out = "";
  s = s + 1; s = s * 2; s = s - 3; s = s + 4; s = s % 7;
  s = s * 3; s = s - 1; s = s + 9; s = s % 5; s = s + 8;
  if (s > 10) out += "A";
  if (s > 8) out += "B";
  if (s > 6) out += "C";
  if (s > 4) out += "D";
  if (s > 2) out += "E";
  if (s > 0) out += "F";
  out = out + ":" + s;
  console.log("trace", out);
  return out;
}