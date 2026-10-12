// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { diverTranslator } from "@/i18n/messages";
import {
  type MastheadFacts,
  mastheadArrivalLine,
  mastheadWhenLine,
  ReadyBookedHeader,
  ReadyMastheadMeta,
} from "./ReadyMasthead";

afterEach(cleanup);

/** Sunday 2026-10-11, 7:00–10:30 in Key Largo (EDT, UTC−4). */
const FACTS: MastheadFacts = {
  shop: {
    name: "Blue Mantis Divers",
    slug: "blue-mantis",
    timezone: "America/New_York",
    dockCallMinutes: 30,
  },
  trip: {
    id: "11111111-2222-4333-8444-555555555555",
    title: "Morning Two-Tank — Molasses Reef",
    startsAt: new Date("2026-10-11T11:00:00Z"),
    endsAt: new Date("2026-10-11T14:30:00Z"),
  },
  pickup: { time: null, location: null },
};

/** The evening before, in the shop's zone. */
const NIGHT_BEFORE = new Date("2026-10-10T23:00:00Z");

function withProvider(locale: "en-US" | "es-ES", node: React.ReactNode) {
  return (
    <DiverIntlProvider locale={locale} timeZone="America/New_York" namespaces={["trip", "common"]}>
      {node}
    </DiverIntlProvider>
  );
}

describe("mastheadWhenLine", () => {
  it("leads with the relative day, so it can never orphan at the end of a wrapped line", () => {
    // UX review 2026-10-10, item 8: "Sun, Oct 11 · 7:00 AM – 10:30 AM EDT ·
    // tomorrow" wrapped on a phone and left "· tomorrow" alone on a line.
    const line = mastheadWhenLine(FACTS, "en-US", NIGHT_BEFORE);
    expect(line).toMatch(/^Tomorrow · Sun, Oct\s11 · /);
    expect(line).toMatch(/EDT$/);
    expect(line).not.toMatch(/tomorrow$/i);
  });

  it("raises the relative day's first letter in the reader's own language", () => {
    expect(mastheadWhenLine(FACTS, "es-ES", NIGHT_BEFORE).startsWith("Mañana · ")).toBe(true);
  });

  it("says today on the day", () => {
    const morning = new Date("2026-10-11T09:00:00Z");
    expect(mastheadWhenLine(FACTS, "en-US", morning).startsWith("Today · ")).toBe(true);
  });
});

describe("mastheadArrivalLine", () => {
  const t = diverTranslator("en-US");

  it("names the dock call by default", () => {
    expect(mastheadArrivalLine(FACTS, "en-US", t)).toContain("6:30");
  });

  it("names the hotel pickup in its place when one is scheduled", () => {
    const line = mastheadArrivalLine(
      { ...FACTS, pickup: { time: "6:10 AM", location: "Reef Inn" } },
      "en-US",
      t,
    );
    expect(line).toContain("6:10 AM");
    expect(line).toContain("Reef Inn");
    expect(line).not.toContain("6:30");
  });
});

describe("ReadyBookedHeader", () => {
  it("opens the page on the moment: shop, greeting, departure, when and the dock", () => {
    // UX review 2026-10-10, item 34: the Logbook register, a period and no
    // exclamation, every fact from the booking's own row.
    render(
      withProvider(
        "en-US",
        <ReadyBookedHeader
          facts={FACTS}
          greetingName="Priya Sharma"
          locale="en-US"
          now={NIGHT_BEFORE}
          t={diverTranslator("en-US")}
        />,
      ),
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("You’ve got a seat, Priya.");
    expect(screen.getByText("Blue Mantis Divers")).toBeTruthy();
    expect(screen.getByText(/^Morning Two-Tank\s— Molasses Reef$/)).toBeTruthy();
    expect(screen.getByText(/^Tomorrow · Sun, Oct\s11/)).toBeTruthy();
    expect(screen.getByText(/Aim to be at the dock by 6:30/)).toBeTruthy();
    // Still the page's own doors under the card.
    expect(screen.getByRole("link", { name: "Add to calendar" })).toBeTruthy();
  });

  it("claims the seat and never the boat, in either language", () => {
    // Dive-domain review 2026-10-12: the card paints before readiness is read
    // and takes no readiness input at all, so a diver in medical review or
    // short a certification level sees it too. Whatever it says must be true
    // of them: they hold a seat; whether they board is the thread's to say.
    for (const locale of ["en-US", "es-ES"] as const) {
      const { container, unmount } = render(
        withProvider(
          locale,
          <ReadyBookedHeader
            facts={FACTS}
            greetingName="Priya Sharma"
            locale={locale}
            now={NIGHT_BEFORE}
            t={diverTranslator(locale)}
          />,
        ),
      );
      expect(container.textContent, locale).not.toMatch(/on the boat|a bordo|aboard/i);
      unmount();
    }
  });

  it("greets a nameless booking without an empty comma", () => {
    render(
      withProvider(
        "en-US",
        <ReadyBookedHeader
          facts={FACTS}
          greetingName=""
          locale="en-US"
          now={NIGHT_BEFORE}
          t={diverTranslator("en-US")}
        />,
      ),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toMatch(/, \./);
  });

  it("spends no emoji and no exclamation in either language", () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      const { container, unmount } = render(
        withProvider(
          locale,
          <ReadyBookedHeader
            facts={FACTS}
            greetingName="Priya"
            locale={locale}
            now={NIGHT_BEFORE}
            t={diverTranslator(locale)}
          />,
        ),
      );
      const heading = container.querySelector("h1")?.textContent ?? "";
      expect(heading, locale).not.toMatch(/[!¡]/);
      expect(heading, locale).not.toMatch(/\p{Extended_Pictographic}/u);
      unmount();
    }
  });
});

describe("ReadyMastheadMeta", () => {
  it("says the relative day first under the ordinary masthead too", () => {
    render(
      withProvider(
        "en-US",
        <ReadyMastheadMeta
          facts={FACTS}
          locale="en-US"
          now={NIGHT_BEFORE}
          t={diverTranslator("en-US")}
        />,
      ),
    );
    expect(screen.getByText(/^Tomorrow · Sun, Oct\s11/)).toBeTruthy();
    expect(screen.getByText(/This page is yours to keep/)).toBeTruthy();
  });
});
