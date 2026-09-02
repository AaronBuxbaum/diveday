import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXEMPT_FILE,
  findDomainStrings,
  findProseLiterals,
  guardedRoots,
  looksLikeCopy,
  proseFreeFiles,
} from "./check-domain-strings.mjs";

/**
 * `scripts/domain-strings-baseline.json` is empty, so this check is a **full
 * gate** over `src/lib`, `src/db` and `src/features`: any prose-named property
 * holding a sentence fails it. As with `check-copy.mjs`, that makes a too-broad
 * exclusion's failure mode a green run — nothing to notice, and ADR
 * 20260731-domain-layer-copy-leaks's rule quietly off.
 *
 * Which is why every rule is pinned in **both** directions: the code shape it
 * must excuse, and whether a real sentence survives it. `pnpm agent:health`
 * listed this guard under "no test pins their judgement" until 2026-09-02
 * (issue #1258); it was the last of the three copy scanners without one, and
 * the only one whose leak is invisible at the call site — `{blocker.message}`
 * is a variable reference, so the JSX scanner never sees the English reaching
 * the screen.
 */

const messages = (source) => findDomainStrings(source).map((hit) => hit.text);

describe("looksLikeCopy — prose reports", () => {
  it("takes an English sentence returned from the domain layer", () => {
    expect(looksLikeCopy("That seat is taken")).toBe(true);
    expect(looksLikeCopy("No answer needs physician sign-off")).toBe(true);
  });

  it("takes a sentence whose punctuation ends a clause", () => {
    // The property-access rule is suppressed by sentence punctuation, so
    // "Everyone is home. Close the day out." does not read as `foo.bar`.
    expect(looksLikeCopy("Everyone is home. Close the day out.")).toBe(true);
  });
});

describe("looksLikeCopy — codes and syntax do not", () => {
  it("excuses the codes this layer is supposed to return", () => {
    // The whole point of the rule: `src/lib` returns these, `src/app` words them.
    expect(looksLikeCopy("waiver_missing")).toBe(false);
    expect(looksLikeCopy("cert-below-requirement")).toBe(false);
    expect(looksLikeCopy("blocked")).toBe(false);
  });

  it("excuses an all-caps abbreviation, which is an agency code and not a word", () => {
    // PADI, SSI, NAUI, EANx — these belong in the domain layer as they are.
    expect(looksLikeCopy("PADI")).toBe(false);
    expect(looksLikeCopy("EANX")).toBe(false);
    expect(looksLikeCopy("USD")).toBe(false);
  });

  it("excuses operators, template holes and statement separators", () => {
    expect(looksLikeCopy("a && b")).toBe(false);
    expect(looksLikeCopy("value => other")).toBe(false);
    expect(looksLikeCopy("left === right")).toBe(false);
    expect(looksLikeCopy("trip?.name")).toBe(false);
    expect(looksLikeCopy(`total \${amount} due`)).toBe(false);
    expect(looksLikeCopy("const a = 1; return a")).toBe(false);
  });

  it("excuses property access, a call, a path and a slug", () => {
    expect(looksLikeCopy("trip.waiverComplete")).toBe(false);
    expect(looksLikeCopy("formatDate()")).toBe(false);
    expect(looksLikeCopy("./relative/path")).toBe(false);
    expect(looksLikeCopy("#anchor")).toBe(false);
    expect(looksLikeCopy("blue-mantis")).toBe(false);
  });

  it("refuses a value with no run of two letters", () => {
    expect(looksLikeCopy("1")).toBe(false);
    expect(looksLikeCopy("42%")).toBe(false);
    expect(looksLikeCopy("a")).toBe(false);
  });
});

describe("findDomainStrings — the property-name scan", () => {
  it("finds a sentence under each prose-named property", () => {
    for (const name of ["message", "label", "text", "reason", "summary"]) {
      expect(messages(`const R = { ${name}: "That seat is taken" };`)).toEqual([
        `${name}: "That seat is taken"`,
      ]);
    }
  });

  it("finds one in single quotes and in a template literal", () => {
    expect(messages("const R = { message: 'That seat is taken' };")).toEqual([
      'message: "That seat is taken"',
    ]);
    expect(messages("const R = { message: `That seat is taken` };")).toEqual([
      'message: "That seat is taken"',
    ]);
  });

  it("leaves a code under a prose-named property alone", () => {
    // `reason: "waiver_missing"` is the shape the rule exists to *permit*.
    expect(messages('const R = { reason: "waiver_missing" };')).toEqual([]);
  });

  it("leaves a property whose name is not on the list alone", () => {
    // No `title`/`description`: both collide with Stripe metadata and
    // structured-data objects, which are common here and are not prose maps.
    expect(messages('const R = { title: "That seat is taken" };')).toEqual([]);
    expect(messages('const R = { description: "That seat is taken" };')).toEqual([]);
  });

  it("never reads prose out of a comment", () => {
    expect(messages('// message: "That seat is taken"\nconst a = 1;')).toEqual([]);
    expect(messages('/* message: "That seat is taken" */\nconst a = 1;')).toEqual([]);
  });

  it("reports the line the string is on, counting the comments it stripped", () => {
    // `stripComments` blanks a comment rather than removing it, precisely so
    // the line number a developer is sent to is the real one.
    const source = '/* one\n * two\n */\nconst R = { message: "That seat is taken" };';
    expect(findDomainStrings(source)[0].line).toBe(4);
  });
});

describe("findDomainStrings — exemptions", () => {
  it("honours a reasoned exemption on the line and on the line above", () => {
    expect(messages('const R = { message: "Ready to dive" }; // i18n-exempt: brand name')).toEqual(
      [],
    );
    expect(messages('// i18n-exempt: brand name\nconst R = { message: "Ready to dive" };')).toEqual(
      [],
    );
  });

  /**
   * Narrowed 2026-09-02 with `check-copy.mjs`'s (issue #1258). The reason check
   * was `\s*\S`; it now demands a letter. This file only ever sees `//`
   * comments — it walks `.ts`, never `.tsx` — so it never had the `*​/`
   * loophole that made the JSX form reasonless. It is narrowed with its sibling
   * anyway: two copies of one rule that disagree is how the next hole gets in,
   * and every reason written in the guarded roots already starts with a letter.
   */
  it("refuses an exemption with no reason", () => {
    expect(messages('// i18n-exempt:\nconst R = { message: "Ready to dive" };')).toEqual([
      'message: "Ready to dive"',
    ]);
    expect(EXEMPT_FILE.test("// i18n-exempt-file:")).toBe(false);
    expect(EXEMPT_FILE.test("// i18n-exempt-file: template copy a shop then owns")).toBe(true);
  });

  it("does not let prose in a string switch the whole file off", () => {
    // An escape hatch a sentence can trigger is a hole, not a hatch: the marker
    // has to appear as an actual comment.
    expect(
      EXEMPT_FILE.test('const R = { message: "Write i18n-exempt-file: reason to skip" };'),
    ).toBe(false);
  });
});

describe("findProseLiterals — the stricter registry rule", () => {
  it("finds any multi-word literal, under a prose-named property or not", () => {
    // In a key registry every sentence is a leak, whatever it is called.
    expect(findProseLiterals('const F = { key: "marketing.grid.manifest" };')).toEqual([]);
    expect(findProseLiterals('const F = { key: "Everything on one boat manifest" };')).toHaveLength(
      1,
    );
  });

  it("leaves a single word and a dotted key alone", () => {
    expect(findProseLiterals('const F = ["owner", "captain"];')).toEqual([]);
    expect(findProseLiterals('const F = ["switching.fareharbor.title"];')).toEqual([]);
  });

  it("honours a reasoned exemption, since not every literal is language", () => {
    expect(
      findProseLiterals(
        '// i18n-exempt: a cited document title\nconst F = ["Dive Safety Manual"];',
      ),
    ).toEqual([]);
  });
});

describe("against the real tree", () => {
  it("names roots and registry files that exist, so the gate cannot silently scan nothing", async () => {
    // A guarded root that was renamed would make this check pass over an empty
    // walk — green, and guarding nothing.
    for (const root of guardedRoots) {
      const entries = await readdir(path.join(process.cwd(), root));
      expect(entries.length, `${root} is empty or missing`).toBeGreaterThan(0);
    }
    for (const file of proseFreeFiles) {
      const siblings = await readdir(path.join(process.cwd(), path.dirname(file)));
      expect(siblings, `${file} is gone`).toContain(path.basename(file));
    }
  });
});
