// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { IncidentCertificationEvidence } from "@/lib/incident-export";
import { CertificationLine } from "./CertificationLine";

/**
 * One line of the departure log's certification evidence. The *facts* on it
 * are the incident export's (`src/lib/incident-export.test.ts`); this pins how
 * the line sets them, on the one document a shop hands an insurer.
 */

afterEach(cleanup);

const t = staffTranslator("en-US");
const WHEN = "Jul 21, 2026, 7:05 AM EDT";

function evidence(overrides: Partial<IncidentCertificationEvidence> = {}) {
  return {
    kind: "level",
    agency: "padi",
    level: "open_water",
    specialty: null,
    identifier: "PADI-12-3456",
    status: "verified",
    reviewedAt: "2026-07-21T11:05:00.000Z",
    reviewedByName: "Keiko Tanaka",
    imported: false,
    selfDeclared: false,
    ...overrides,
  } satisfies IncidentCertificationEvidence;
}

function renderLine(card: IncidentCertificationEvidence) {
  const { container } = render(
    <p>
      <CertificationLine
        t={t}
        card={card}
        agencyText={(agency) => agency.toUpperCase()}
        dateTime={() => WHEN}
      />
    </p>,
  );
  return container.firstElementChild as HTMLElement;
}

describe("the card number", () => {
  /**
   * Four of eighteen certification lines split their number at a hyphen on a
   * phone — "PADI-12-" on one line and "3456" on the next — on the document an
   * investigator reads a number aloud from (K-355, DEPARTURE-4-05). The number
   * is set whole, the rule the emergency phone already takes (issue #1035),
   * and never rewritten with non-breaking hyphens: a copied number has to
   * match the card.
   */
  it("is set whole, in a span that does not wrap", () => {
    const line = renderLine(evidence());
    const number = [...line.querySelectorAll("span")].find(
      (span) => span.textContent === "PADI-12-3456",
    );
    expect(number, "the number has a span of its own").toBeTruthy();
    expect(number).toHaveClass("whitespace-nowrap");
  });

  it("reads exactly as the message says", () => {
    // Word for word; only the space before each separator is a no-break one
    // (see "the line's separators" below).
    const message = t("incidentExport.certLevelLine", {
      agency: "PADI",
      level: t("shared.readiness.certificationLevels.openWater"),
      identifier: "PADI-12-3456",
    });
    const text = renderLine(evidence()).textContent ?? "";
    expect(text.startsWith(message.replaceAll(" · ", "\u00a0· "))).toBe(true);
  });

  it("leaves the no-number phrase free to wrap, since it is words and not a number", () => {
    const line = renderLine(evidence({ identifier: null, status: "pending", selfDeclared: true }));
    expect(line).toHaveTextContent(t("incidentExport.certNoNumber"));
    expect(line.querySelector(".whitespace-nowrap")).toBeNull();
  });
});

describe("the line's separators", () => {
  /**
   * Every " · " on the line was breakable on both sides, so a wrap could put
   * the dot at the start of the next line: at 390 Lena ×2, June, Nadia and
   * Ines led a line with "· Certified" or "· Pending review", while other
   * rows ended theirs with it (K-552, DEPARTURE-4-48). A no-break space before
   * each dot keeps it with what it follows, so a line can only break after one.
   */
  for (const [label, card] of [
    ["a verified, imported card", evidence({ imported: true })],
    ["a self-declared card", evidence({ identifier: null, status: "pending", selfDeclared: true })],
    ["a specialty card", evidence({ kind: "specialty", level: null, specialty: "deep" })],
    ["a nitrox card", evidence({ kind: "nitrox", level: null })],
  ] as const) {
    it(`glue every dot to what comes before it (${label})`, () => {
      const text = renderLine(card).textContent ?? "";
      const dots = [...text.matchAll(/·/g)];
      expect(dots.length, "the line has separators to check").toBeGreaterThanOrEqual(2);
      for (const dot of dots) {
        expect(text[(dot.index ?? 0) - 1], `before the dot at ${dot.index}`).toBe("\u00a0");
      }
    });
  }
});
