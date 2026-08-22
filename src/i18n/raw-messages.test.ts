import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "./messages";
import { DIVER_LOCALES } from "./settings";
import { STAFF_MESSAGES } from "./staff-messages";

/**
 * `t.raw(key)` / `st.raw(key)` hands an *unformatted* template across the
 * server/client boundary, and the client resolves it with `fill()` — a
 * `/\{(\w+)\}/g` replace that can only see a bare `{name}`. An ICU plural or
 * select in a message fetched that way therefore survives to the screen
 * verbatim: `pnpm check:locale` passes (both bundles carry the key), no test
 * asserts the sentence, and a shop reads
 * `{divemasters, plural, one {# divemaster} …}` on its own schedule board.
 * That happened at `boats.requestPlanCrewSuggestion` and
 * `schedule.builder.requestPlanPerson` (issue #606), where the first also used
 * `st()` — which *does* format, and so threw on every board render outside
 * production, while production swallowed the error and printed the template.
 *
 * The contract this pins is the one between the two halves: a message whose
 * words are composed on the client says its plural as a `…One`/`…Other` pair
 * for `pluralForm()` to choose between, never as ICU.
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The eleven the gate found already in the tree when it was written, all in
 * the CSV import wizard, all tracked in issue #649. A shop moving its data
 * over reads ICU source on the preview step, on the submit button, and through
 * the whole done-step summary. They are not fixed here because two of them
 * need a shape decision rather than a mechanical split, and the import surface
 * is security-sensitive enough to deserve its own review.
 *
 * A ratchet, not an exemption: the list may only shrink, and every entry has
 * to still resolve to a real message, so it cannot quietly rot into a list of
 * keys nobody has.
 */
const ALLOWLIST = [
  "settings.import.issues.specialtyImportedVerified",
  "settings.import.issues.specialtyImportedPending",
  "settings.import.wizard.waiverRowsNotice",
  "settings.import.wizard.visitRowsNotice",
  "settings.import.wizard.paymentHistoryRowsNotice",
  "settings.import.wizard.submit",
  "settings.import.wizard.result.cardsLine",
  "settings.import.wizard.result.waiversLine",
  "settings.import.wizard.result.visitsLine",
  "settings.import.wizard.result.paymentHistoryLine",
  "settings.import.wizard.result.notesLine",
];

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

/** Every `.ts`/`.tsx` under `src/` except the bundles — and except this file,
 * whose own prose quotes the very shapes it is looking for. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "locales" ? [] : sourceFiles(full);
    if (full === fileURLToPath(import.meta.url)) return [];
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

/** Every key a `pattern` match yields, as key -> the files that ask for it. */
function callSites(
  pattern: RegExp,
  keysIn: (match: RegExpMatchArray) => string[],
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      for (const key of keysIn(match)) {
        found.set(key, [...(found.get(key) ?? []), relative(SRC_DIR, file)]);
      }
    }
  }
  return found;
}

/**
 * `t.raw("some.key")` / `st.raw("some.key")` — asked for as a template.
 *
 * The `,?` is not decoration. `biome.json` sets `lineWidth: 100` and
 * `trailingCommas: "all"`, so a call whose key pushes the line past 100 is
 * reformatted to `t.raw(\n  "some.key",\n)` — and a pattern that cannot cross
 * that comma goes blind on exactly the longest keys, which is the wrong half
 * to lose.
 */
const RAW_CALL = /\.raw\(\s*"([a-zA-Z][\w.]*)"\s*,?\s*\)/g;

/**
 * A call whose whole argument list is keys — `t("some.key")`,
 * `staffT("some.key")`, `t(long ? "a.key" : "b.key")` — and no values. The
 * other half of #606: the board fetched an ICU plural this way, and next-intl
 * raised `FORMATTING_ERROR` for the argument that by definition was not there.
 * `translatorOnError` rethrows outside production, so the whole board crashed
 * to its error boundary in dev; in production it swallowed the error and
 * printed the fallback, which was the raw template.
 *
 * Deliberately blind to the *receiver*: an earlier version matched only `t` and
 * `st`, which meant renaming a local `const st =` to `const staffT =` switched
 * the gate off for that whole file — and nineteen production calls already
 * bind the translator to `anonT`, `staffT`, `diverT` or `tRoot`. The argument
 * list may hold no comma and no nested call, so a call carrying values never
 * matches; `.raw` receivers are dropped below because they are the other rule's
 * business. A key must be dotted, which is what keeps an ordinary
 * `expect("something")` out of the net.
 */
const KEYS_ONLY_CALL = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\s*([^(),`]*?)\s*,?\s*\)/g;
const DOTTED_KEY = /"([a-zA-Z][\w]*(?:\.[\w]+)+)"/g;

function formattedKeysIn(match: RegExpMatchArray): string[] {
  if (match[1].endsWith(".raw")) return [];
  return [...match[2].matchAll(DOTTED_KEY)].map((key) => key[1]);
}

/**
 * An ICU argument carrying a *type* — `{n, plural, …}`, `{when, date, short}`,
 * `{amount, number}`. `fill()` resolves a bare `{name}` and nothing else, so
 * any of these reaches the screen as source. Not just `plural`: a date skeleton
 * leaks exactly the same way and would have passed a narrower rule.
 */
const ICU_ARGUMENT_TYPE = /\{\s*\w+\s*,\s*\w/;

/**
 * Whether a message has an argument the caller must supply.
 *
 * ICU-quoted segments are stripped first, but only the ones ICU actually
 * treats as quoted: `'` opens a literal section only when the next character is
 * `{`, `}` or `#`. That is what lets `courses.edit.errorDepthPlaceholder` show
 * a shop the literal `'{depth18}'` marker to type. A blanket `'[^']*'` strip
 * would also swallow everything between two *prose* apostrophes — which in
 * this bundle means `"You're on {shopName}'s list…"` loses its `{shopName}`
 * and reads as naming no argument at all.
 */
function namesAnArgument(message: string): boolean {
  return /\{\s*\w/.test(message.replace(/'[{}#][^']*'/g, ""));
}

describe("messages fetched with .raw()", () => {
  const sites = callSites(RAW_CALL, (match) => [match[1]]);

  it("finds the call sites at all", () => {
    expect(sites.size).toBeGreaterThan(20);
  });

  it("resolves every key it finds in a bundle", () => {
    const unresolved = [...sites].filter(
      ([key]) =>
        !(key in flatten(DIVER_MESSAGES["en-US"])) && !(key in flatten(STAFF_MESSAGES["en-US"])),
    );
    expect(unresolved.map(([key, files]) => `${key} (${files.join(", ")})`)).toEqual([]);
  });

  it("carries no ICU plural or select, in any locale", () => {
    const leaked: string[] = [];
    for (const locale of DIVER_LOCALES) {
      const bundles = {
        diver: flatten(DIVER_MESSAGES[locale]),
        staff: flatten(STAFF_MESSAGES[locale]),
      };
      for (const [key, files] of sites) {
        for (const [which, bundle] of Object.entries(bundles)) {
          const message = bundle[key];
          if (message === undefined || !ICU_ARGUMENT_TYPE.test(message)) continue;
          if (ALLOWLIST.includes(key)) continue;
          leaked.push(`${locale} ${which}.${key} (read raw by ${files.join(", ")}): ${message}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });

  it("never formats a message that names an argument with no arguments", () => {
    const bundles = {
      diver: flatten(DIVER_MESSAGES["en-US"]),
      staff: flatten(STAFF_MESSAGES["en-US"]),
    };
    const unfed: string[] = [];
    for (const [key, files] of callSites(KEYS_ONLY_CALL, formattedKeysIn)) {
      for (const [which, bundle] of Object.entries(bundles)) {
        const message = bundle[key];
        if (message === undefined || !namesAnArgument(message)) continue;
        unfed.push(`${which}.${key} (formatted with no values by ${files.join(", ")}): ${message}`);
      }
    }
    expect(unfed).toEqual([]);
  });

  it("keeps every allowlisted key real, and does not grow the list", () => {
    const staff = flatten(STAFF_MESSAGES["en-US"]);
    const stale = ALLOWLIST.filter(
      (key) => !sites.has(key) || !ICU_ARGUMENT_TYPE.test(staff[key] ?? ""),
    );
    expect(stale).toEqual([]);
    expect(ALLOWLIST.length).toBeLessThanOrEqual(11);
  });
});
