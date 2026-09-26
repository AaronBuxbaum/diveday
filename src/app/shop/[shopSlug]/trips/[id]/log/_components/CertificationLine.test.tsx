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
    const line = renderLine(evidence());
    expect(
      line.textContent?.startsWith(
        t("incidentExport.certLevelLine", {
          agency: "PADI",
          level: t("shared.readiness.certificationLevels.openWater"),
          identifier: "PADI-12-3456",
        }),
      ),
    ).toBe(true);
  });

  it("leaves the no-number phrase free to wrap, since it is words and not a number", () => {
    const line = renderLine(evidence({ identifier: null, status: "pending", selfDeclared: true }));
    expect(line).toHaveTextContent(t("incidentExport.certNoNumber"));
    expect(line.querySelector(".whitespace-nowrap")).toBeNull();
  });
});
