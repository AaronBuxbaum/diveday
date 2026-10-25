// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { DiverChecklistItem } from "@/lib/readiness-summary";
import { CertificationEntries } from "./CertificationEntries";

vi.mock("../cert-actions", () => {
  const action = async () => {};
  return {
    declareNoCertificationFromReady: action,
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
        notYet={null}
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
        notYet={null}
        t={t}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pills the nitrox offer the trip does not require, and never doubles a required one", () => {
    const { container } = render(
      <CertificationEntries token="tok" item={item([])} offerNitrox notYet={null} t={t} />,
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
        notYet={null}
        t={t}
      />,
    );
    expect(summaries(required.container)).toEqual([t("ready.nitroxCertHeading")]);
    expect(screen.queryByText(t("ready.certOptional"))).toBeNull();
  });
  it("offers 'not certified yet' beside the card form when the shop holds nothing", () => {
    render(
      <CertificationEntries
        token="tok"
        item={item([{ code: "certification_missing" }])}
        offerNitrox={false}
        notYet={null}
        t={t}
      />,
    );
    expect(screen.getByText(t("ready.certNotYetLead"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("ready.certNotYetButton") })).toBeInTheDocument();
  });

  it("asks once before telling the shop there is no card", () => {
    render(
      <CertificationEntries
        token="tok"
        item={item([{ code: "certification_missing" }])}
        offerNitrox={false}
        notYet={null}
        t={t}
      />,
    );
    // The first tap only arms the question; nothing is sent until "Yes".
    expect(screen.queryByText(t("ready.certNotYetConfirm"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("ready.certNotYetButton") }));
    expect(screen.getByText(t("ready.certNotYetConfirm"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("ready.certNotYetConfirmButton") }),
    ).toHaveAttribute("type", "submit");
    fireEvent.click(screen.getByRole("button", { name: t("ready.neverMind") }));
    expect(screen.queryByText(t("ready.certNotYetConfirm"))).toBeNull();
    expect(screen.getByRole("button", { name: t("ready.certNotYetButton") })).toBeInTheDocument();
  });

  it("never offers 'not certified yet' over a card already on file", () => {
    render(
      <CertificationEntries
        token="tok"
        item={item([{ code: "certification_insufficient" }])}
        offerNitrox={false}
        notYet={null}
        t={t}
      />,
    );
    expect(screen.queryByRole("button", { name: t("ready.certNotYetButton") })).toBeNull();
  });

  it("after 'not yet', opens the try-it course and keeps the card form for a found card", () => {
    const { container } = render(
      <CertificationEntries
        token="tok"
        item={item([])}
        offerNitrox={false}
        notYet={{ introCourse: { title: "Discover Scuba Diving", href: "/s/reef/courses/dsd" } }}
        t={t}
      />,
    );
    const door = screen.getByRole("link", {
      name: t("ready.certNotYetHowToStart", { course: "Discover Scuba Diving" }),
    });
    expect(door).toHaveAttribute("href", "/s/reef/courses/dsd");
    expect(summaries(container)).toEqual([t("ready.certHeading")]);
    expect(screen.queryByRole("button", { name: t("ready.certNotYetButton") })).toBeNull();
  });

  // B26 (visual review 2026-10-24): the step's one action at rest is a filled
  // primary, as Sign and Gear are; the other cards stay quiet disclosure rows,
  // and the form's own save is primary once it opens.
  it("makes the card's resting action the step's filled primary", () => {
    const { container } = render(
      <CertificationEntries
        token="tok"
        item={item([{ code: "certification_missing" }, { code: "nitrox_missing" }])}
        offerNitrox={false}
        notYet={null}
        t={t}
      />,
    );
    const [card, nitrox] = [...container.querySelectorAll("summary")];
    expect(card).toHaveTextContent(t("ready.certHeading"));
    expect(card).toHaveClass("bg-primary", "text-primary-foreground", "group-open/cert:sr-only");
    expect(nitrox).not.toHaveClass("bg-primary");
    const [cardSave] = screen.getAllByRole("button", { name: t("ready.certSubmit") });
    expect(cardSave).toHaveClass("bg-primary");
  });
});
