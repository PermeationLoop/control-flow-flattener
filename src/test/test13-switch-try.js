// Atomic constructs — switch (with internal breaks), try/catch/finally,
// for and for-of with break — are kept whole inside a single slice; their
// own control flow must keep working inside the machine. Plain JS file to
// exercise the JS input path end to end. `catch (e)` is untyped here.
function order(n = 0) {
  let out = "";
  try {
    switch (n) {
      case 0:
        out += "zero";
        break;
      case 1:
        out += "one";
        break;
      default:
        out += "many";
        if (n === 2) throw new Error("boom");
    }
  } catch (e) {
    out += ":" + (e instanceof Error ? e.message : "?");
  } finally {
    out += "!";
  }
  for (let i = 0; i < n; i++) {
    out += i;
  }
  const arr = ["x", "y", "z"];
  let joined = "";
  for (const c of arr) {
    joined += c;
    if (joined.length === 2) break;
  }
  out += "|" + joined;
  console.log(out);
  return out;
}