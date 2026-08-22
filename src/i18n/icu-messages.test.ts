import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "./messages";
import { DIVER_LOCALES } from "./settings";
import { STAFF_MESSAGES } from "./staff-messages";

/**
 * Every message in every bundle is compiled and formatted here, rather than
 * only the handful a rendered surface happens to reach.
 *
 * Both translators are built with `onError: () => {}` so that one bad string
 * degrades to a fallback instead of blanking a page — which is right in
 * production and blind in a test: a malformed `{count, plural, …}` renders the
 * key and nothing throws, so it surfaces whenever some rare surface (a stale
 * crew roll call, an empty-state) is next looked at. A bulk copy edit touches
 * dozens of plurals at once, so the compile has to be its own assertion.
 */

/** Every leaf as `dotted.path` → message. */
function flatten(node: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      Object.assign(out, flatten(value as Record<string, unknown>, dotted));
    } else {
      out[dotted] = String(value);
    }
  }
  return out;
}

/** `<link>…</link>` style rich-text tags, which take a function rather than a value. */
function tagsIn(message: string): Set<string> {
  return new Set([...message.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)>/g)].map((match) => match[1]));
}

/** The argument types whose braces hold *branches* rather than more text. */
const BRANCHING_TYPES = new Set(["plural", "selectordinal", "select"]);

/**
 * `{name}`, `{count, plural, …}`, `{hasNote, select, …}` — the argument names a
 * message consumes, tags excluded.
 *
 * **A scan, not a pattern, because a `{` means two different things.** It opens
 * an argument in text, and it opens a *branch body* inside a plural or select.
 * A regex cannot tell them apart, and the one that used to live here —
 * `/\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*[,}]/g` — read a branch whose body is a
 * single word as an argument named after that word. So
 * `{count, plural, =0 {None} one {# package} other {# packages}}` reported
 * `None, count`, its Spanish twin reported `Ninguno, count`, and the
 * cross-locale test below failed on two perfectly correct messages with a
 * message confident enough to read like a real translation bug (issue #813).
 *
 * Every `=0` branch in these bundles happened to be more than one word, which
 * is the only reason it never fired.
 *
 * The scanner tracks one thing: whether the brace about to open sits in text or
 * in a branch list. That also makes it exact rather than shallow — a nested
 * argument inside a branch is found because the branch body is text again.
 */
function argsIn(message: string): Set<string> {
  const tags = tagsIn(message);
  const args = new Set<string>();
  // `true` while the next `{` opens a branch body rather than an argument.
  const inBranchList: boolean[] = [false];
  const branching = () => inBranchList[inBranchList.length - 1] === true;

  for (let i = 0; i < message.length; i += 1) {
    const char = message[i];

    // ICU quoting: `'` opens a literal run only when the next character is one
    // it would otherwise have to escape. Anything else is an apostrophe in
    // prose ("You're on {shopName}'s list"), and treating it as a quote would
    // swallow the argument between two of them — the same rule
    // `raw-messages.test.ts` states at more length.
    if (char === "'" && /[{}#]/.test(message[i + 1] ?? "")) {
      const close = message.indexOf("'", i + 1);
      i = close === -1 ? message.length : close;
      continue;
    }

    if (char === "}") {
      if (inBranchList.length > 1) inBranchList.pop();
      continue;
    }
    if (char !== "{") continue;

    if (branching()) {
      // A branch body. Its contents are text, so a `{` inside it opens an
      // argument again.
      inBranchList.push(false);
      continue;
    }

    const rest = message.slice(i + 1);
    const named = /^\s*([a-zA-Z][a-zA-Z0-9]*)\s*(,\s*([a-zA-Z]+))?/.exec(rest);
    // Not an argument at all — `{#}`, or a stray brace. Push text so the
    // matching `}` still balances the stack.
    if (!named) {
      inBranchList.push(false);
      continue;
    }
    if (!tags.has(named[1])) args.add(named[1]);
    inBranchList.push(BRANCHING_TYPES.has(named[3] ?? ""));
  }

  return args;
}

/**
 * A stand-in for every argument the message names: `count` for plain values
 * (a number, so `{n, plural, …}` and `{n, number}` both work), and an identity
 * callback for rich-text tags. Built concretely rather than as a `Proxy`
 * because next-intl copies the values object before formatting, which drops
 * any trap that isn't backed by a real own property.
 */
function valuesFor(message: string, count: number): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const name of argsIn(message)) values[name] = count;
  for (const tag of tagsIn(message)) values[tag] = (chunks: unknown) => chunks;
  return values;
}

/**
 * **The scanner itself**, because everything below it is only as good as this.
 *
 * The bundles are a corpus that happens to avoid the bug — every `=0` branch in
 * them is more than one word — so a green suite proved nothing about the case
 * that actually failed (issue #813).
 */
describe("the argument scanner", () => {
  const args = (message: string) => [...argsIn(message)].sort();

  it("reads a one-word plural branch as a branch, not an argument", () => {
    // The message that surfaced this: `None` and its Spanish `Ninguno` were
    // reported as arguments, so the two locales disagreed about a message that
    // formats identically in both.
    expect(args("{count, plural, =0 {None} one {# package} other {# packages}}")).toEqual([
      "count",
    ]);
    expect(args("{count, plural, =0 {Ninguno} one {# paquete} other {# paquetes}}")).toEqual([
      "count",
    ]);
  });

  it.each([
    ["a bare argument", "{name}", ["name"]],
    ["a typed argument", "{when, date, short}", ["when"]],
    ["a select", "{tone, select, warm {Warm} other {Cool}}", ["tone"]],
    ["a selectordinal", "{n, selectordinal, one {#st} other {#th}}", ["n"]],
    ["several in one sentence", "{a} and {b, number}", ["a", "b"]],
  ])("still finds %s", (_label, message, expected) => {
    expect(args(message)).toEqual(expected);
  });

  it("finds an argument nested inside a branch", () => {
    // The old scan found these by accident, being global over the raw string.
    // This one finds them because a branch body is text again — which is also
    // why it does not mistake the branch itself for one.
    expect(args("{count, plural, one {Just {name}} other {# divers with {name}}}")).toEqual([
      "count",
      "name",
    ]);
  });

  it("does not count a rich-text tag as an argument", () => {
    expect(args("<strong>{site}</strong> also requires {list}.")).toEqual(["list", "site"]);
  });

  it("keeps an argument standing between two prose apostrophes", () => {
    // `'` opens an ICU literal only before `{`, `}` or `#`. Reading every
    // apostrophe as a quote would swallow `{shopName}` here and report the
    // message as naming nothing.
    expect(args("You're on {shopName}'s list")).toEqual(["shopName"]);
  });

  it("respects a genuinely escaped brace", () => {
    expect(args("Type '{depth18}' exactly")).toEqual([]);
  });
});

const BUNDLES = [
  { name: "diver", messages: DIVER_MESSAGES },
  { name: "staff", messages: STAFF_MESSAGES },
] as const;

describe.each(BUNDLES)("$name bundle", ({ messages }) => {
  it.each(DIVER_LOCALES)("compiles and formats every message in %s", (locale) => {
    const errors: string[] = [];
    const t = createTranslator({
      locale,
      messages: messages[locale] as Record<string, unknown>,
      onError: (error) => errors.push(error.message),
    });
    const bundle = flatten(messages[locale] as Record<string, unknown>);

    for (const [key, message] of Object.entries(bundle)) {
      // Each plural category is a separate branch of ICU to walk into: 0 and 1
      // and 2 cover zero/one/other, and 5 the languages that split "few" from
      // "many". A syntax error anywhere in the message throws on the first.
      for (const count of [0, 1, 2, 5]) {
        // `.rich` rather than `t()`: it accepts plain values *and* the tag
        // callbacks that `<link>` style messages need, so one call covers both
        // shapes. The return value is discarded — compiling is the assertion.
        t.rich(key as never, valuesFor(message, count) as never);
      }
    }

    expect(errors).toEqual([]);
  });

  it("asks for the same arguments in every locale", () => {
    // A translation that quietly drops `{count}` (or renames it) formats
    // without complaint and prints a sentence with a hole in it. The English
    // bundle is the reference because it is the one the fallback returns.
    const reference = flatten(messages["en-US"] as Record<string, unknown>);
    const drifted = DIVER_LOCALES.filter((locale) => locale !== "en-US").flatMap((locale) => {
      const bundle = flatten(messages[locale] as Record<string, unknown>);
      return Object.entries(reference).flatMap(([key, english]) => {
        const translated = bundle[key];
        if (translated === undefined) return [];
        const expected = [...argsIn(english), ...tagsIn(english)].sort();
        const actual = [...argsIn(translated), ...tagsIn(translated)].sort();
        return expected.join(",") === actual.join(",")
          ? []
          : [`${locale} ${key}: expected {${expected.join(", ")}}, got {${actual.join(", ")}}`];
      });
    });
    expect(drifted).toEqual([]);
  });
});
