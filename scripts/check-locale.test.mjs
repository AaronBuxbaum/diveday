import { describe, expect, it } from "vitest";

import {
  auditIdenticalBaseline,
  compareValues,
  DELIBERATELY_IDENTICAL,
  locateKey,
  nothingToTranslate,
} from "./check-locale.mjs";

/**
 * Rule 3 — "translated means translated" — is the half of this guard that can
 * be wrong quietly, because its floor is a number and a number nobody can
 * reproduce is worse than no number. So the counting rule is pinned here (what
 * counts, what is skipped, and that a missing key is rule 2's failure rather
 * than an identical value), and so is the ratchet in **both** directions: a
 * rise refused and a fall that must be banked. The fall is the half these tests
 * usually skip and the half that breaks.
 */

const DIVER = { file: "diver.json", minimumKeys: 40 };
const STAFF = { dir: "staff", minimumKeys: 1 };

describe("where a merged key lives", () => {
  it("keeps a single-file bundle's key as it is", () => {
    expect(locateKey(DIVER, "common.units.meters")).toEqual({
      file: "diver.json",
      path: "common.units.meters",
    });
  });

  it("splits the staff namespace back off, because the namespace is the filename", () => {
    expect(locateKey(STAFF, "shared.compass.n")).toEqual({
      file: "staff/shared.json",
      path: "compass.n",
    });
  });

  it("handles a namespace whose whole bundle is one key", () => {
    expect(locateKey(STAFF, "whatsapp")).toEqual({ file: "staff/whatsapp.json", path: "whatsapp" });
  });
});

describe("counting identical values", () => {
  const declared = new Map([["diver.json brand.name", "brand name"]]);

  it("counts a byte-identical string, per bundle file", () => {
    const { identical } = compareValues(
      DIVER,
      { a: "Boarded", b: "Nitrox" },
      { a: "A bordo", b: "Nitrox" },
      declared,
    );
    expect([...identical.entries()]).toEqual([["diver.json", ["b"]]]);
  });

  it("does not count a key the other locale is missing — that is rule 2's failure", () => {
    // Counting it would make the floor unreproducible and would say "English in
    // the Spanish bundle" about a key that simply is not there yet.
    const { identical } = compareValues(DIVER, { a: "Boarded" }, {}, declared);
    expect(identical.size).toBe(0);
  });

  it("skips a non-string leaf on either side", () => {
    const { identical } = compareValues(DIVER, { a: 3, b: "x" }, { a: 3, b: 4 }, declared);
    expect(identical.size).toBe(0);
  });

  it("leaves a declared key out of the count", () => {
    const { identical, stale } = compareValues(
      DIVER,
      { "brand.name": "DiveDay" },
      { "brand.name": "DiveDay" },
      declared,
    );
    expect(identical.size).toBe(0);
    expect(stale).toEqual([]);
  });

  it("fails a declared key that is no longer identical, so the list cannot rot", () => {
    const { stale } = compareValues(
      DIVER,
      { "brand.name": "DiveDay" },
      { "brand.name": "BuceoDía" },
      declared,
    );
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("declared identical (brand name)");
    expect(stale[0]).toContain("delete the entry");
  });

  it("addresses a staff declaration by its own file, not by the directory", () => {
    const { identical } = compareValues(
      STAFF,
      { "shared.compass.n": "N", "gear.itemKinds.dpv": "DPV" },
      { "shared.compass.n": "N", "gear.itemKinds.dpv": "DPV" },
      new Map([["staff/shared.json compass.n", "same letter on both compasses"]]),
    );
    expect([...identical.entries()]).toEqual([["staff/gear.json", ["itemKinds.dpv"]]]);
  });
});

describe("the ratchet", () => {
  const counts = new Map([
    ["es-ES/diver.json", 57],
    ["es-ES/staff/shared.json", 16],
  ]);

  it("is silent when the baseline matches reality", () => {
    expect(
      auditIdenticalBaseline(counts, { "es-ES/diver.json": 57, "es-ES/staff/shared.json": 16 }),
    ).toEqual([]);
  });

  it("fails a file with no baseline entry", () => {
    const failures = auditIdenticalBaseline(counts, { "es-ES/diver.json": 57 });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("es-ES/staff/shared.json: 16 es-ES values identical");
  });

  it("fails a count that rose, and names the declaration escape hatch", () => {
    const failures = auditIdenticalBaseline(counts, {
      "es-ES/diver.json": 56,
      "es-ES/staff/shared.json": 16,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("baseline allows 56");
    expect(failures[0]).toContain("DELIBERATELY_IDENTICAL");
  });

  it("fails an unbanked fall, so a translation lands with its own baseline edit", () => {
    const failures = auditIdenticalBaseline(counts, {
      "es-ES/diver.json": 58,
      "es-ES/staff/shared.json": 16,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("down to 57 from 58");
    expect(failures[0]).toContain("--write");
  });

  it("fails a stale entry for a file that is clean or gone", () => {
    const failures = auditIdenticalBaseline(counts, {
      "es-ES/diver.json": 57,
      "es-ES/staff/shared.json": 16,
      "es-ES/staff/deleted.json": 2,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("es-ES/staff/deleted.json");
  });

  it("says nothing at all before the baseline file exists", () => {
    // The first run writes it; a repo with no baseline is being set up, not
    // failing, and this is the branch every other ratchet here takes too.
    expect(auditIdenticalBaseline(counts, {}, false)).toEqual([]);
  });
});

describe("the declared list", () => {
  it("gives every entry a reason", () => {
    for (const [address, reason] of DELIBERATELY_IDENTICAL) {
      expect(reason.trim(), address).not.toBe("");
    }
  });

  it("addresses every entry as a bundle file plus a key inside it", () => {
    for (const address of DELIBERATELY_IDENTICAL.keys()) {
      const [file, key, ...rest] = address.split(" ");
      expect(rest, address).toEqual([]);
      expect(file, address).toMatch(/^(diver\.json|staff\/[A-Za-z]+\.json)$/);
      expect(key, address).toMatch(/^[A-Za-z][\w]*(\.[\w]+)*$/);
    }
  });

  it("leaves `rescue` out of the certification ladder, which has a Spanish form", () => {
    // "Buceador de Rescate". The four rungs that stay English are named; this
    // is the entry whose absence is the point.
    const declared = [...DELIBERATELY_IDENTICAL.keys()].join("\n");
    expect(declared).toContain("course.certificationLevels.openWater");
    expect(declared).not.toContain("certificationLevels.rescue");
  });
});

/**
 * The one structural exemption (issue #1797), which is the judgement in this
 * guard that could quietly become a blanket one. It has to clear a value with
 * no word in it and hold on to every value that has one — including the two
 * shapes that look like templates and are not: a unit beside a placeholder, and
 * a plural whose branches are English prose.
 */
describe("a value with nothing in it to translate", () => {
  it.each([
    "{date} · {trip}",
    "{tripTitle}",
    "“{words}”",
    "{count, number}",
    "{from} – {until}",
    "#",
    "—",
    "…",
    "<diver>{diverName}</diver> · <trip>{tripTitle}</trip> · {date}",
  ])("clears %j", (value) => {
    expect(nothingToTranslate(value)).toBe(true);
  });

  it.each([
    // A unit or a word beside a placeholder is still a word.
    "{value} ft",
    "Re: {subject}",
    "{agency} · Nitrox",
    "Stripe: {id}",
    // Plain prose, with no template about it at all.
    "Walk-in",
    // The shape that would make this exemption dangerous: the branches of a
    // plural are real sentences, and they sit inside braces.
    "{count, plural, one {# diver is waiting} other {# divers are waiting}}",
    // And the same trap one level down, where the sub-message is the only
    // English left.
    "{count, plural, other {# aboard}}",
  ])("keeps %j in the count", (value) => {
    expect(nothingToTranslate(value)).toBe(false);
  });

  it("keeps the words between rich-text tags, dropping only the tag names", () => {
    expect(nothingToTranslate("<b>Sold out</b>")).toBe(false);
  });

  /**
   * The reason this reads the gaps between the markup instead of deleting the
   * markup and reading what is left (CodeQL alert 47 on PR #1809). Stripping
   * `<diver>` out of `<<diver>diver>` reassembles a tag that was never there
   * and answers "nothing to translate" about a value full of letters. Nothing
   * here was ever sanitizing anything, but the mistake is one line away, and
   * this is the line that would have made it.
   */
  it("does not let a nested tag reassemble into one it would have dropped", () => {
    expect(nothingToTranslate("<<diver>diver>")).toBe(false);
  });
});
