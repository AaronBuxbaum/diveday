import { describe, expect, it } from "vitest";
import {
  type CertificationSummaryShape,
  certificationSummaryBelowRequirementText,
  certificationSummaryText,
  certificationSummaryUnchecked,
} from "./readiness-labels";
import { staffTranslator } from "./staff-messages";

/**
 * **The phrase a staffer reads beside a name before they mail a discount.**
 *
 * Two facts ride in it and they are deliberately carried by two different
 * things: whether anybody has *seen* a card (a tone, plus the "diver's word"
 * words) and whether this person is *under the departure's bar* (words only).
 * Collapsing either into the other is what these assertions exist to stop —
 * the warning tone means exactly one thing (ADR 20260814-self-declared-cards)
 * and colour is never the only carrier of meaning (design/principles.md #6).
 */
const t = staffTranslator("en-US");
const tEs = staffTranslator("es-ES");

function summary(overrides: Partial<CertificationSummaryShape> = {}): CertificationSummaryShape {
  return {
    level: "open_water",
    levelSelfDeclared: false,
    noCertificationDeclared: false,
    nitrox: false,
    nitroxSelfDeclared: false,
    ...overrides,
  };
}

describe("certificationSummaryText", () => {
  it("states a card the shop holds plainly", () => {
    expect(certificationSummaryText(t, summary(), "en-US")).toBe("Open Water");
  });

  it("marks a claim nobody has checked, in words", () => {
    expect(certificationSummaryText(t, summary({ levelSelfDeclared: true }), "en-US")).toBe(
      "Open Water — diver's word, no certification record",
    );
  });

  it("states an absent level rather than leaving the row blank", () => {
    expect(certificationSummaryText(t, null, "en-US")).toBe("Level not said");
  });

  /**
   * **The line between an answer and silence**, which is the whole reason
   * `people.no_certification_declared_at` exists. Until it did, a Discover
   * Scuba customer and a certified regular who skipped the question rendered
   * the same, and the shop mailed both a certified two-tank charter.
   */
  it("tells a stated 'no card' apart from an unanswered question", () => {
    expect(
      certificationSummaryText(t, summary({ level: null, noCertificationDeclared: true }), "en-US"),
    ).toBe("Not certified yet — diver's word");
    expect(
      certificationSummaryText(
        tEs,
        summary({ level: null, noCertificationDeclared: true }),
        "es-ES",
      ),
    ).toBe("Todavía sin certificación — dicho por el buceador");
  });

  /**
   * The stamp is ignored, never deleted, once a level lands beside it (ADR
   * 20260814-self-declared-cards) — so a diver who declared "not certified" and
   * later declared a rung, or was later carded, reads as the rung. The phrase
   * is the one place that precedence is decided.
   */
  it("draws the level, not the stamp, once one is on file", () => {
    expect(certificationSummaryText(t, summary({ noCertificationDeclared: true }), "en-US")).toBe(
      "Open Water",
    );
  });

  /**
   * Both halves are the diver's own word here, which is the only way the two
   * can appear together: a nitrox card the *shop* holds supersedes the stamp in
   * `listCertificationSummaries`, so "no card at all" can never render beside a
   * card somebody has actually seen. A claim can follow a claim, though — the
   * stamp today, a nitrox tick on a later join — and it renders as what it is.
   */
  it("keeps a nitrox claim visible beside the stated 'no card'", () => {
    expect(
      certificationSummaryText(
        t,
        summary({
          level: null,
          noCertificationDeclared: true,
          nitrox: true,
          nitroxSelfDeclared: true,
        }),
        "en-US",
      ),
    ).toBe("Not certified yet — diver's word, Nitrox — diver's word, no certification record");
  });
});

describe("certificationSummaryBelowRequirementText", () => {
  it("adds the words to a verified card that ranks under the departure", () => {
    // The finding this exists for: a verified Open Water diver on an Advanced
    // charter is muted, calm, and said nothing about the bar he is under.
    expect(certificationSummaryBelowRequirementText(t, summary(), "en-US")).toBe(
      "Open Water · below this departure's minimum",
    );
  });

  it("keeps the self-declared mark alongside it rather than replacing it", () => {
    expect(
      certificationSummaryBelowRequirementText(t, summary({ levelSelfDeclared: true }), "en-US"),
    ).toBe("Open Water — diver's word, no certification record · below this departure's minimum");
  });

  it("says it in Spanish too", () => {
    expect(certificationSummaryBelowRequirementText(tEs, summary(), "es-ES")).toBe(
      "Open Water · por debajo del mínimo de esta salida",
    );
  });
});

describe("certificationSummaryUnchecked", () => {
  it("is false for a card the shop holds, whatever the rung", () => {
    // Being under the bar must never turn this true: the tone it drives means
    // "nobody has seen this card" and nothing else.
    expect(certificationSummaryUnchecked(summary())).toBe(false);
  });

  it("is true when any part of the phrase is only the diver's word", () => {
    expect(certificationSummaryUnchecked(summary({ levelSelfDeclared: true }))).toBe(true);
    expect(certificationSummaryUnchecked(summary({ nitrox: true, nitroxSelfDeclared: true }))).toBe(
      true,
    );
    // "Not certified yet" is the diver's word too — and the row a staffer most
    // needs to catch before a certified charter goes out to it.
    expect(
      certificationSummaryUnchecked(summary({ level: null, noCertificationDeclared: true })),
    ).toBe(true);
  });

  it("stops being the diver's word once a card the shop holds is on file", () => {
    // The stamp survives (provenance is history) but the phrase draws the card,
    // so the tone must not go on colouring words nobody is reading.
    expect(certificationSummaryUnchecked(summary({ noCertificationDeclared: true }))).toBe(false);
  });
});
