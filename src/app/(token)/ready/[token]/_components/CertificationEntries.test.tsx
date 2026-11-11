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
    showCertificationAtCheckInFromReady: action,
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
      t("ready.certAtCheckIn"),
      t("ready.specialtyHeading", { specialty: "Deep" }),
      t("ready.nitroxCertHeading"),
    ]);
    for (const details of container.querySelectorAll("details")) {
      expect(details.open).toBe(false);
    }
  });

  it.each(["en-US", "es-ES"] as const)(
    "shows a saved lower card and every unmet requirement in %s",
    (locale) => {
      const translate = diverTranslator(locale);
      render(
        <CertificationEntries
          token="tok"
          item={item([
            {
              code: "certification_insufficient",
              params: {
                requiredLevel: "advanced_open_water",
                heldLevel: "open_water",
                heldUnverified: true,
              },
            },
            { code: "specialty_missing", params: { specialty: "deep" } },
            { code: "nitrox_missing" },
          ])}
          offerNitrox={false}
          notYet={null}
          t={translate}
        />,
      );
      expect(
        screen.getByText(
          locale === "en-US"
            ? "Your Open Water certification is saved and awaiting verification. This trip needs Advanced Open Water or higher. Contact the shop about a suitable trip or course; add another card only if you already hold it."
            : "Tu certificación Open Water está guardada y pendiente de verificación. Esta salida requiere Advanced Open Water o superior. Contacta al centro para elegir una salida o un curso adecuado; agrega otra tarjeta solo si ya la tienes.",
        ),
      ).toBeVisible();
      expect(
        screen.getByText(
          translate("ready.specialtyHeading", {
            specialty: locale === "en-US" ? "Deep" : "Profundidad",
          }),
        ),
      ).toBeVisible();
      expect(screen.getByText(translate("ready.nitroxCertHeading"))).toBeVisible();
      expect(screen.queryByText(translate("ready.certNotYetLead"))).toBeNull();
    },
  );

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
    fireEvent.click(screen.getByRole("button", { name: t("words.dismiss.neverMind") }));
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
    // Open, the step keeps its heading above the form (layer 7): the panel
    // opens with the summary's words, hidden from a screen reader, which has
    // the summary itself.
    const heading = card.parentElement?.querySelector("div > p[aria-hidden='true']");
    expect(heading).toHaveTextContent(t("ready.certHeading"));
    expect(heading?.nextElementSibling).not.toBeNull();
  });

  // B26 review (dde-a F2): a card on file but too low is the shop's to talk
  // through, and re-typing it reads "Nothing more to do", so the form does not
  // lead the step there; nor after "not yet", where the form is for a card
  // found in a drawer.
  it("keeps the card form quiet when a card is on file, or after 'not yet'", () => {
    const { container, unmount } = render(
      <CertificationEntries
        token="tok"
        item={item([{ code: "certification_insufficient" }])}
        offerNitrox={false}
        notYet={null}
        t={t}
      />,
    );
    const [insufficient] = [...container.querySelectorAll("summary")];
    expect(insufficient).toHaveTextContent(t("ready.certHeading"));
    expect(insufficient).not.toHaveClass("bg-primary");
    unmount();
    const notYet = render(
      <CertificationEntries
        token="tok"
        item={item([])}
        offerNitrox={false}
        notYet={{ introCourse: null }}
        t={t}
      />,
    );
    const [found] = [...notYet.container.querySelectorAll("summary")];
    expect(found).not.toHaveClass("bg-primary");
  });

  it("leads with the card form for a self-declared card too", () => {
    const { container } = render(
      <CertificationEntries
        token="tok"
        item={item([{ code: "certification_self_declared" }])}
        offerNitrox={false}
        notYet={null}
        t={t}
      />,
    );
    const [card] = [...container.querySelectorAll("summary")];
    expect(card).toHaveClass("bg-primary");
  });
});

it("offers a number-free check-in answer while retaining the numbered card form", () => {
  const { container } = render(
    <CertificationEntries
      token="tok"
      item={item([{ code: "certification_missing" }])}
      offerNitrox={false}
      notYet={null}
      t={t}
    />,
  );
  const forms = [...container.querySelectorAll("form")];
  const checkIn = forms.find((form) => form.textContent?.includes(t("ready.certAtCheckIn")));
  expect(checkIn?.querySelector('[name="agency"]')).toBeRequired();
  expect(checkIn?.querySelector('[name="level"]')).toBeRequired();
  expect(checkIn?.querySelector('[name="identifier"]')).toBeNull();
  expect(container.querySelector('[name="identifier"]')).toBeRequired();
});

it("keeps number entry optional when an unsighted card is with the shop", () => {
  const waiting = {
    ...item([]),
    code: "certification_self_declared",
    state: "waiting",
  } as DiverChecklistItem;
  const { container } = render(
    <CertificationEntries token="tok" item={waiting} offerNitrox={false} notYet={null} t={t} />,
  );
  expect(summaries(container)).toEqual([t("ready.certHeading")]);
  expect(container.querySelector("details")).not.toHaveAttribute("open");
});
