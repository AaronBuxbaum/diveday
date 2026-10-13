// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { DiverChecklistItem } from "@/lib/readiness-summary";
import { CertificationEntries } from "./CertificationEntries";

vi.mock("../cert-actions", () => {
  const action = async () => {};
  return {
    saveCertificationFromReady: action,
    saveNitroxCertificationFromReady: action,
    saveSpecialtyFromReady: action,
  };
});

const t = diverTranslator("en-US");

afterEach(cleanup);

function item(actionable: DiverChecklistItem["actionable"]): DiverChecklistItem {
  return {
    category: "certification",
    state: "your_turn",
    detailCode: "certification_missing",
    actionable,
  } as unknown as DiverChecklistItem;
}

function summaries(container: HTMLElement) {
  return [...container.querySelectorAll("summary")].map((summary) => summary.textContent);
}

describe("CertificationEntries", () => {
  it("puts one collapsed form under every card the diver can send", () => {
    const { container } = render(
      <CertificationEntries
        token="tok"
        item={item([
          { code: "certification_missing" },
          { code: "specialty_missing", params: { specialty: "deep" } },
          { code: "nitrox_missing" },
        ])}
        offerNitrox={false}
        t={t}
      />,
    );
    expect(summaries(container)).toEqual([
      t("ready.certHeading"),
      t("ready.specialtyHeading", { specialty: "Deep" }),
      t("ready.nitroxCertHeading"),
    ]);
    for (const details of container.querySelectorAll("details")) {
      expect(details.open).toBe(false);
    }
  });

  it("offers no form for a card already with the shop", () => {
    const { container } = render(
      <CertificationEntries
        token="tok"
        item={item([{ code: "certification_pending" }])}
        offerNitrox={false}
        t={t}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pills the nitrox offer the trip does not require, and never doubles a required one", () => {
    const { container } = render(
      <CertificationEntries token="tok" item={item([])} offerNitrox t={t} />,
    );
    expect(summaries(container)).toEqual([
      `${t("ready.nitroxCertHeading")}${t("ready.certOptional")}`,
    ]);
    cleanup();
    const required = render(
      <CertificationEntries
        token="tok"
        item={item([{ code: "nitrox_missing" }])}
        offerNitrox
        t={t}
      />,
    );
    expect(summaries(required.container)).toEqual([t("ready.nitroxCertHeading")]);
    expect(screen.queryByText(t("ready.certOptional"))).toBeNull();
  });
});
