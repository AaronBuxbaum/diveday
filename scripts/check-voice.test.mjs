import { describe, expect, it } from "vitest";

import { findTells, proseDashes, RULES } from "./check-voice.mjs";

const rules = (value, locale = "en-US") => findTells(value, locale).map((hit) => hit.rule);

describe("the prose em-dash", () => {
  it("catches a dash between two clauses", () => {
    expect(
      rules("Who's booked, who's cleared, who's on the boat — one answer, all day."),
    ).toContain("em-dash");
    expect(rules("No email on file — add one from the roster, then resend.")).toContain("em-dash");
  });

  it("catches a dash in a sentence even when one side is short", () => {
    // "Not a block" is two words, but the string carries a full stop, so it is
    // prose and the dash replaced a colon.
    expect(
      rules("Not a block — plan shallower, or confirm the guide keeps them within limits."),
    ).toContain("em-dash");
  });

  it("catches a double hyphen standing in for one", () => {
    expect(rules("The importer shows every column -- and every row it skipped.")).toContain(
      "em-dash",
    );
  });

  it("reports each dash in a string once", () => {
    expect(proseDashes("A file — not a project — the importer shows what lands.")).toHaveLength(2);
  });

  it("leaves a short label separator alone", () => {
    // Not sentences: a status and its count, a state and its undo hint.
    expect(rules("Boarded — tap again to undo")).toEqual([]);
    expect(rules("Checked in — 2")).toEqual([]);
    expect(rules("Blocked — certification")).toEqual([]);
    expect(rules("Two-Tank Reef — Molasses & French")).toEqual([]);
  });

  it("leaves an en-dash range alone", () => {
    expect(rules("Dive 1 — Molasses Reef, 18 m, 8:05 – 8:47".replace("—", ":"))).toEqual([]);
    expect(rules("Today · 7:30–11:00 AM")).toEqual([]);
  });

  it("leaves a bare dash placeholder alone", () => {
    expect(rules("—")).toEqual([]);
  });
});

describe("the word rules", () => {
  it("catches an intensifier", () => {
    expect(rules("You can see the confirmation actually arrived.")).toContain("filler");
    expect(rules("Some of this is genuinely unsettled.")).toContain("filler");
    expect(rules("It simply works.")).toContain("filler");
  });

  it("does not catch the water lock's literal unlock", () => {
    expect(rules("Hold to unlock")).toEqual([]);
  });

  it("catches a lead-in", () => {
    expect(rules("Here's how to get your file out of EVE yourself.")).toContain("leadIn");
    expect(rules("Rest assured, nothing is lost.")).toContain("leadIn");
  });

  it("does not catch a price locked in today's number", () => {
    expect(rules("Founding shops lock in today's price for two years.")).toEqual([]);
  });

  it("catches the not-just contrast", () => {
    expect(rules("DiveDay isn't just a booking tool.")).toContain("notJust");
    expect(rules("It's more than just a list.")).toContain("notJust");
  });

  it("leaves a factual scope refusal alone", () => {
    expect(rules("No retail register and no agency sync.")).toEqual([]);
  });

  it("catches the staccato run", () => {
    expect(rules("No setup fee. No per-seat math. No feature tiers.")).toContain("staccato");
  });

  it("leaves two full sentences that happen to start with No alone", () => {
    expect(
      rules(
        "No agency lets software verify a certification automatically. Nothing on this page pretends otherwise.",
      ),
    ).toEqual([]);
  });
});

describe("locales", () => {
  it("names a word list for every locale the bundles carry", () => {
    expect(Object.keys(RULES).sort()).toEqual(["en-US", "es-ES"]);
  });

  it("holds Spanish to its own list", () => {
    expect(rules("Puedes ver que la confirmación llegó realmente.", "es-ES")).toContain("filler");
    expect(rules("Sin cuota de alta. Sin cálculos por plaza.", "es-ES")).toContain("staccato");
    expect(rules("Un precio único — {price} {cadence}. Sin comisión.", "es-ES")).toContain(
      "em-dash",
    );
  });

  it("refuses a locale with no rules", () => {
    expect(() => findTells("Bonjour", "fr-FR")).toThrow(/no voice rules/);
  });
});
