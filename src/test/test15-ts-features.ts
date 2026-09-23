// Full TypeScript flavor through the transpile path: erased constructs
// (interface, type alias, type annotations, generics, `as`, `!`) disappear,
// an enum compiles to a runtime object at top level, and the flattened
// function body must see the exact same values.
// `Map` is used deliberately: the generic type-arg `Map<string, T>` and the
// `as`/`!` operators on its `.get` result are exactly the transpile surface
// this fixture exists to exercise.
interface Label {
  value: number;
}
type Pair = [string, number];
enum Kind {
  Zero = 0,
  One = 1,
}

const pick = <T>(map: Map<string, T>, key: string): T => {
  const hit = map.get(key) as T | undefined;
  return hit!;
};

function order(n = 0): string {
  const label: Label = { value: n };
  const pair: Pair = ["v", label.value];
  const kind: Kind = n % 2 === 0 ? Kind.Zero : Kind.One;
  const m = new Map<string, number>([
    ["a", 5],
    ["b", 9],
  ]);
  const got: number = pick(m, kind === Kind.Zero ? "a" : "b");
  console.log(pair.join("="), "kind", kind, "got", got);
  return `${pair[0]}=${label.value}:${got}`;
}