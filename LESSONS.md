# Control-Flow Flattener — Lessons Learned & Reference

Purpose: everything learned while building the Babel-based CFF (src/hoist.ts,
src/slice.ts, src/flatten.ts), distilled into design principles and pitfalls,
with each flattener decision mapped to what a **deobfuscator** must reverse.
Read this when (re)building either side.

---

## 1. The pipeline (4 layers, always in this order)

```
source ──parse──▶ File AST ──hoist──▶ scope-safe statements
         ──slice──▶ state table ──compile──▶ while+switch machine
```

| Layer | File | Job |
|---|---|---|
| Parse | `@babel/parser` | source string → `File` |
| M1 traverse | `@babel/traverse` | walk & mutate; `path.scope` on demand |
| M2 hoist | `src/hoist.ts` | rename shadowed bindings → hoist declarations & function decls → assignments |
| M3 slice | `src/slice.ts` | statements → `Slice[]` table (structure → allocate → wire) |
| M4 compile | `src/flatten.ts` | table → `let __state=0; while (__state!==EXIT) switch(__state){ case N: … }` |

M3's `Slice` table is the **contract** between slicer and compiler. Keep it a
plain data structure: any pass can print it (debug oracle), compile it, or
diff it.

---

## 2. Core design ideas

1. **Flattening moves control flow into data.** The machine keeps *no*
   syntactic control flow besides one loop and one switch; every jump is a
   `state = N` assignment. Semantics are preserved by construction, so
   verification is a runtime comparison, not a proof.

2. **Every slice is a basic block.** Exactly one entry (state id); one
   fall-through exit (`seq`, `break`, `continue`) or two branch exits
   (`if`, `while` test). This is the CFG unit both in and out: the
   deobfuscator rebuilds blocks exactly at these boundaries.

3. **Statements are the unit; expressions stay atomic.** Only statement
   kinds carry control flow. Expressions (incl. `a && b`, `a ? b : c`, `??`)
   are implicit control flow and stay inside one statement. *Test
   expressions* are the exception: they are lifted into the branch slices.
   Slice granularity (1..N statements per state) is an obfuscation knob, not
   a correctness question — grouping is semantically free (a group is a
   sequential block).

4. **Scope destruction requires scope prep first.** The machine's case arms
   sit at function scope; any `let`/`const`/function declared inside would be
   trapped in a case or collide across blocks. Fix *before* slicing:
   - alpha-rename shadowed bindings (Babel `scope.rename` + `generateUid`)
   - hoist all declarations to the function top as one uninitialized `var`
   - convert inline declarations to assignments (destructuring stays a
     *native destructuring assignment* — `({a} = obj);` needs no temporaries)
   - hoist FunctionDeclarations as intact nodes (JS already hoists them at
     runtime; the machine would trap or skip them otherwise)

5. **Numbering (allocation) is independent of semantics (wiring).** Allocate
   state ids in any order (DFS = natural reading order); *then* wire
   terminators. Never compute a `next` during allocation — forward references
   force a two-pass design. This separation is what makes state permutation
   (an obfuscator trick) harmless: ids are keys, not positions.

6. **Reuse native control transfer.** `case N: … break;` (switch break),
   `continue;` (re-tests the machine loop), and `return` inside a case all do
   exactly what the machine needs — synthesizing any of them would be a bug
   farm. `break`/`continue` *slices* write the next state first, then transfer
   control.

7. **A sentinel EXIT ends the machine.** `while (__state !== EXIT)`.
   `return`/`throw` inside a case terminate the function natively and make
   any later writes dead code.

8. **Fail loudly, not silently.** Unsupported syntax (labels) throws at slice
   time. A miscompile that runs is worse than a crash that doesn't.

---

## 3. Slice kinds (the table schema)

| kind | payload | machine case | CFG meaning |
|---|---|---|---|
| `seq` | `stmts[]`, `next` | `stmts; __state = next; break;` | basic block → linear edge |
| `if` | `test`, `nextTrue`, `nextFalse`, `merge` | `if (test) __state=A; else __state=B; break;` | branch, both chains converge at `merge` |
| `while` | `test`, `nextBody`, `merge` | `if (test) __state=body; else __state=merge; break;` | loop test; body exits back to test id |
| `break` | `next` (= enclosing while's `merge`) | `__state = next; break;` | loop exit edge |
| `continue` | `next` (= enclosing while's test id) | `__state = next; continue;` | loop back-edge |

The `while` slice is the deobfuscator's cycle marker: `test → body-chain →
test` is exactly a CFG back-edge; `merge` is the loop's exit successor.

---

## 4. Pitfalls encountered (flattener side)

### Correctness killers

- **Missing `switch`-case `break` — first candidate for an infinite loop.**
  Every state-driven case must end with `break;` so the loop re-reads
  `__state`. Without it, a switch pass *falls through all cases*, re-runs
  every block, resets indicators, and loops forever. The table looked right;
  only executing the machine caught it.
- **Grouping lookahead must mirror the special-cased types.** The grouping
  prefilter (`shouldAvoidGrouping`) decides what the main pass ever sees. It
  omitted `BlockStatement` and `LabeledStatement`, so the group *swallowed*
  them: a `break` inside a swallowed block became a native switch-break
  (infinite loop), and the label-rejection guard was bypassable. Rule: the
  prefilter and the main dispatch must share one decision predicate.
- **Rename before hoisting — and collect names before renaming.**
  Renaming must precede hoisting (moved code uses new names), and you must
  snapshot the shadowed-name list before calling `scope.rename`, because it
  mutates `scope.bindings`.
- **`const` cannot be hoisted uninitialized** (`const x;` is a parse error).
  Convert kinds; everything becomes `var` (documented drift).
- **Duplicate names across blocks** become redeclaration errors after hoist →
  alpha-rename first.
- **`for`-loop headers must never be hoisted** — `for (let i…)` has a
  per-iteration binding (spec `CreatePerIterationEnvironment`); extracting
  `let i` breaks closures. Keep loop headers intact (or desugar for→while
  *with* a per-iteration clone + rename — the same rename machinery).
- **Function declarations inside case arms are block-scoped** (strict mode) →
  `ReferenceError` from other cases; and a branch can *skip* the declaring
  case. Hoist them to the function top.
- **Labels are positions, not states.** A labeled `break` targets the end of
  the labeled statement — no state exists for it. Reject `LabeledStatement`
  with a loud error; unblocking later requires allocating a "label target"
  state and wiring `break label → that state`, `continue label → the labeled
  loop's test state`.

### Semantic drift to accept (document, don't "fix")

- `let`/`const` → `var`: TDZ gone, const-reassignment protection gone.
- Block scope → function scope: a shadowed `let` renamed to a uid still
  behaves differently if outer code reads the merged slot (renaming fixes
  identity, not lifetime).
- Loop/block function declarations become function-scoped; closure identity
  per iteration is lost if the loop body is flattened (ours stays atomic).

### Environment / integration gotchas

- Babel 8 ships its own `.d.ts` — the v7 `@types/babel__traverse` /
  `@types/babel__generator` stubs conflict (they type against
  `@babel/types@7`). Do not install them.
- Babel 8 types are stricter than v7: destructuring patterns are
  `PatternLike`, not `LVal`; `VoidPattern` is not assignable to an assignment
  LHS; `ArrayPattern.elements` is wider than `PatternLike`. Guard/narrow with
  `t.isX` before building nodes.
- `@babel/parser` without the TypeScript plugin rejects `: number`
  annotations — test fixtures must be plain JS (default params for typing).
- `new Function`-based run-compare harness executes in *sloppy* mode; module
  or strict code under test needs an equivalent harness.
- Structural changes invalidate `path.scope` caches — take bindings before
  mutating, and re-parse before relying on scope state again.

---

## 5. What a real obfuscator adds on top of your M4 output

Assume all of these when deobfuscating; none of them change the CFG model:

- renames the state variable (`__state` → `_0x2f`), maybe aliases it
  (`t = state; … state = t + 1`)
- encodes EXIT (non-literal sentinel, `state === 0xFFFF ^ 0xBAAD`)
- **permutes case order** — ids are keys, order is meaningless
- injects **junk/dead states** and **opaque predicates**
  (`if (x ^ 1 === ~x) state = dead;`)
- changes grouping 1..N arbitrarily; splits or merges blocks
- scatters the hoisted `var` back into cases, or wraps declarations in
  aliases; interleaves no-op reads/writes of live variables (these are *not*
  removable without liveness analysis)

---

## 6. Deobfuscator: reverse the machine

### Recognition

A flattened function has the signature:

```js
function f(…) {
  var _0x…;             // hoisted decls (rename-uid flavored)
  let __state = 0;
  while (__state !== EXIT) switch (__state) {
    case N: … __state = M; break;
    case K: if (…test…) __state = A; else __state = B; break;
  }
}
```

Locate the switch-in-while whose condition is `state ≠ literal`. **Beware:
user `while` loops remain as complete `WhileStatement`s inside cases** — do
not confuse them with the machine loop (the machine loop is the outermost
one, its switch's only content is cases).

### CFG recovery (the core algorithm)

1. For each case: the block is its statements; every `state = K` write (its
   own terminal *or* inside a nested `if`/`while` test arm) is an outgoing
   edge `case → K`. The loop's `condition ≠ EXIT` is the exit edge.
2. Build adjacency. Worklist with **visited set** — the CFG is cyclic
   (`while`, `merge`); naive recursion hangs.
3. Structural inverse:
   - linear chain with single pred/succ = sequential statements
     (concatenate in order; drop the state writes)
   - `if (test) → A else → B` where chains `A..M`, `B..M` share successor
     `M` = one `IfStatement(test, A-chain, B-chain)` — **common successor
     is your branch-merge detector**
   - `test → body-chain → test` (back-edge) + `merge` = `while` loop
   - `return`/`throw` inside a block: anything after (e.g. `state = EXIT`)
     is dead — drop
   - states unreachable from state 0 = junk — drop
4. Reconstruct declarations: function-top `var`s dominate all uses; a
   variable assigned exactly once and never re-assigned before its uses →
   `const`, else `let` (conservative: only promote when provable).
   Destructuring assignments reconstitute as `let {a} = obj`.

### Deobfuscation pitfalls

- **Never trust case order or state numbering contiguity** — build the CFG
  from *edges*, not numeric order; gaps are normal.
- A case may hold **several statements** (grouping) — and several **state
  writes** (test slices with nested branches produce 2+ edges).
- Don't strip "dead" code without liveness/dominance evidence — junk states
  may feed opaque predicates that guard REAL transitions.
- Renamed uids carry no meaning — rebuild names from usage; never pattern
  match on `_0x*`.
- `break`/`continue` are already native — no pattern to invert there; an
  obfuscator that replaces them with extra state jumps just adds edges.
- Keep the run-compare harness: golden-output comparison is your
  correctness oracle for the *reconstructed* code too.

---

## 7. Verification recipe (always, both directions)

1. Transform, then **execute** the transformed artifact (never trust
   inspection of the table or the emitted code).
2. Compare original vs transformed for a matrix of inputs (branch truth
   values, loop limits incl. 0/1).
3. Keep the state-table printer as the CFG oracle for debugging.
4. On any semantic drift, bisect to the layer (hoist → slice → compile) by
   rerunning the comparison after each stage.

---

## 8. One-paragraph summary

A flattener is a scope-safe rewriter (hoist + rename) followed by a CFG
encoder: statements become states, assignments to the state variable become
edges, native `switch`/`while`/`break`/`continue` carry the transfers, and a
sentinel EXIT terminates. The deobfuscator is the inverse in the same
vocabulary: recognize the state loop, rebuild the CFG from state-write edges,
merge chains and common successors into structured control flow, and
reconstitute declarations — while assuming an obfuscator has permuted,
renamed, padded, and dead-coded everything around a model that is itself
unchanged.