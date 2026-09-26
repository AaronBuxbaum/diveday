// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The closing block binds the evening's own acts, which live in the home's
// sibling `actions.ts` — a `"use server"` module whose imports reach
// better-auth and the database (the same stub `DaySpine.test.tsx` carries).
vi.mock("@/app/shop/[shopSlug]/actions", () => ({
  closeDayAction: vi.fn(),
  keepRentalFitAction: vi.fn(),
  setLeftoverDecisionAction: vi.fn(),
}));

import type { DayCloseoutRecord } from "@/db/closeout";
import { staffTranslator } from "@/i18n/staff-messages";
import { ClosingBlock } from "./ClosingBlock";

afterEach(cleanup);

/** A close recorded with one of each kind of thing still open. */
const latest: DayCloseoutRecord = {
  id: "close-1",
  shopDay: "2026-08-27",
  closedAt: new Date("2026-08-27T22:10:00Z"),
  actorName: "Dana Reyes",
  outstanding: {
    departures: [
      {
        tripId: "t1",
        title: "Two-Tank Reef",
        status: "count_open",
        gapReason: null,
        uncounted: 0,
      },
    ],
    leftovers: [
      {
        id: "l1",
        kind: "waiver",
        subject: "Lena Fischer",
        detail: "Waiver has not been sent.",
        decision: "carry",
      },
    ],
    adminTasks: [
      { id: "post_dive_reports", status: "pending", total: 3, completed: 1, pending: 2, failed: 0 },
    ],
  },
};

describe("the recorded close", () => {
  /**
   * **A status is one unit** (pixel-craft class 8, K-592). Each item's
   * "— status" wrapped at its own spaces, so a narrow card split it mid-phrase:
   * "— Dock" over "count open", "— Carried to" over "tomorrow" alone. A status
   * that does not fit beside its item moves to the next line whole.
   */
  it("keeps every outstanding item's status whole", () => {
    render(
      <ClosingBlock
        leftovers={[]}
        latest={latest}
        closeCount={1}
        locale="en-US"
        timeZone="America/New_York"
        t={staffTranslator("en-US")}
      />,
    );
    const list = screen.getByText("Two-Tank Reef").closest("ul");
    if (!list) throw new Error("the recorded close listed nothing outstanding");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const item of items) {
      const status = [...item.querySelectorAll("span")].find((span) =>
        span.textContent?.startsWith("—"),
      );
      expect(status, item.textContent ?? "").toBeDefined();
      expect(status).toHaveClass("whitespace-nowrap");
    }
    expect(within(list).getByText("— Dock count open")).toBeInTheDocument();
    expect(within(list).getByText("— Carried to tomorrow")).toBeInTheDocument();
  });
});
