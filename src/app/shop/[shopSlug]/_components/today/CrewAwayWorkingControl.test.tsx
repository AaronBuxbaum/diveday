// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";

// The same mocks the day spine's own tests need: each row control imports a
// `"use server"` module whose imports reach better-auth and the database.
vi.mock("@/app/actions/invoices", () => ({ resendInvoiceAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({ resendConfirmationAction: vi.fn() }));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: vi.fn(),
  undoHeldSendAction: vi.fn(),
  releaseHeldSendAction: vi.fn(),
}));
vi.mock("@/app/shop/[shopSlug]/actions", () => ({
  keepRentalFitAction: vi.fn(),
  acknowledgeCrewAwayAction: vi.fn(),
  helpRequestAction: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CrewAwayWorkingControl } from "./CrewAwayWorkingControl";
import { action, boat, hoursFromNow, renderSpine } from "./day-spine-test-fixtures";

afterEach(cleanup);

/**
 * **"Working it anyway"** on Today's `crew_away` row (issue #2678): one tap per
 * person the row names, in the reader's language, and the row keeps its door
 * to the crew editor.
 */
describe("CrewAwayWorkingControl", () => {
  const people = [
    { personId: "marcus", fullName: "Marcus Webb" },
    { personId: "keiko", fullName: "Keiko Tanaka" },
  ];

  for (const locale of ["en-US", "es-ES"] as const) {
    it(`offers one tap per person the row names, in ${locale}`, () => {
      const t = staffTranslator(locale);
      render(
        <CrewAwayWorkingControl
          tripId="t9"
          people={people.map((person) => ({
            personId: person.personId,
            label: t("today.crewAway.working", { name: person.fullName }),
          }))}
          pendingLabel={t("today.crewAway.saving")}
        />,
      );
      const buttons = screen.getAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual(
        locale === "en-US"
          ? ["Marcus Webb is working it", "Keiko Tanaka is working it"]
          : ["Marcus Webb trabaja igualmente", "Keiko Tanaka trabaja igualmente"],
      );
    });
  }

  it("sits on the spine's crew_away row beside the row's door to the crew", () => {
    renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({
          id: "crew-away:t9",
          kind: "crew_away",
          subject: "Scuba Refresher",
          detail: "Marcus Webb is away Sat, Aug 29.",
          departure: boat("t9"),
          crewAway: { people: [people[0] as (typeof people)[number]] },
          href: "/shop/blue-mantis/trips/t9?view=details#crew",
          dueAt: hoursFromNow(48),
        }),
      ],
    });
    const week = document.querySelector("details") as HTMLElement;
    expect(within(week).getByRole("button", { name: "Marcus Webb is working it" })).toBeTruthy();
    expect(
      within(week)
        .getAllByRole("link")
        .some(
          (link) => link.getAttribute("href") === "/shop/blue-mantis/trips/t9?view=details#crew",
        ),
    ).toBe(true);
  });

  it("never offers the tap about the reader themself (security review)", () => {
    renderSpine({
      readerPersonId: "marcus",
      actions: [
        action({
          id: "crew-away:t9",
          kind: "crew_away",
          subject: "Scuba Refresher",
          detail: "Marcus Webb is away Sat, Aug 29.",
          departure: boat("t9"),
          crewAway: { people: [people[0] as (typeof people)[number]] },
          staffPersonId: "marcus",
          href: "/shop/blue-mantis/trips/t9?view=details#crew",
          dueAt: hoursFromNow(48),
        }),
      ],
    });
    expect(screen.queryByRole("button", { name: "Marcus Webb is working it" })).toBeNull();
    expect(screen.getByText("Marcus Webb is away Sat, Aug 29")).toBeTruthy();
  });
});
