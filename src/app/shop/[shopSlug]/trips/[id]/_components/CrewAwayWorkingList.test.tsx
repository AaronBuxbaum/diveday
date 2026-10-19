// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";

vi.mock("@/app/shop/[shopSlug]/trips/[id]/crew-actions", () => ({
  withdrawCrewAwayAcknowledgementAction: vi.fn(),
}));

import { CrewAwayWorkingList } from "./CrewAwayWorkingList";

afterEach(cleanup);

/**
 * **"No longer working it"** (issue #2678, dock review S2): each person a
 * staffer said is working it anyway, with the way to take it back.
 */
describe("CrewAwayWorkingList", () => {
  for (const locale of ["en-US", "es-ES"] as const) {
    it(`names who said it and offers the way back, in ${locale}`, () => {
      const t = staffTranslator(locale);
      render(
        <CrewAwayWorkingList
          shopSlug="blue-mantis"
          tripId="t9"
          people={[
            { personId: "marcus", fullName: "Marcus Webb", acknowledgedByName: "Dana Ortiz" },
          ]}
          t={t}
        />,
      );
      expect(screen.getByText(/Marcus Webb.*Dana Ortiz/)).toBeTruthy();
      expect(screen.getByRole("button", { name: t("trips.crew.awayWithdraw") })).toBeTruthy();
    });
  }

  it("renders nothing when nobody was said to be working it", () => {
    const { container } = render(
      <CrewAwayWorkingList
        shopSlug="blue-mantis"
        tripId="t9"
        people={[]}
        t={staffTranslator("en-US")}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
