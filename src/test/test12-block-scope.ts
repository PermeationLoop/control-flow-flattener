// Bare blocks get inlined into the enclosing slice; block-local `let`s that
// shadow outer names are renamed to survive the merge into one function
// level var. References inside each block must stay on the block's binding.
function order(n = 0) {
  let out = "";
  {
    let n = 1;
    {
      let n = 2;
      out += "inner" + n;
    }
    out += "mid" + n;
  }
  out += "outer" + String(n);
  console.log(out);
  return out;
}