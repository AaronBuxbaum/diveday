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

/**
 * `{name}`, `{count, plural, …}`, `{hasNote, select, …}` — the argument names a
 * message consumes, tags excluded. Deliberately a shallow scan of the raw
 * string: nested arguments inside a plural branch are named the same way, and
 * an argument this misses is still caught by the format pass below.
 */
function argsIn(message: string): Set<string> {
  const tags = tagsIn(message);
  return new Set(
    [...message.matchAll(/\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*[,}]/g)]
      .map((match) => match[1])
      .filter((name) => !tags.has(name)),
  );
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
