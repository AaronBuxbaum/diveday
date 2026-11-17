// @vitest-environment jsdom
// i18n-exempt-file: test fixture names are seeded data.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { FillSeatsCard } from "./FillSeatsCard";
import type { WhoWantsInRow } from "./who-wants-in-rows";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const t = staffTranslator("en-US");
afterEach(cleanup);

const row = (id: string, name: string): WhoWantsInRow => ({
  interestId: id,
  name,
  email: `${id}@example.com`,
  facts: "Asked yesterday",
  certification: null,
  belowBar: false,
  offeredAt: null,
});

const trip = {
  id: "trip-1",
  shopSlug: "blue-mantis",
  shopName: "Blue Mantis",
  title: "Two-tank reef",
  when: "Sat, Nov 21",
};

function renderCard(over: Partial<Parameters<typeof FillSeatsCard>[0]> = {}) {
  return render(
    <FillSeatsCard
      heading="Fill the last 2"
      groups={[
        { id: "departure", heading: "Asked for this trip", rows: [row("i1", "Ravi Menon")] },
      ]}
      pastGuests={null}
      canOffer
      discount={null}
      addHref="/trip?add=1#add-a-booking"
      addForm={null}
      carry={null}
      trip={trip}
      t={t}
      {...over}
    />,
  );
}

describe("Fill the last N", () => {
  it("lists who asked with Offer a seat, the booking link and Add a guest, in one card", () => {
    renderCard();
    const card = screen.getByRole("region", { name: "Fill the last 2" });
    expect(within(card).getByText("Ravi Menon")).toBeVisible();
    expect(within(card).getByRole("button", { name: /Ravi Menon/ })).toBeVisible();
    expect(within(card).getByRole("button", { name: "Copy link" })).toBeVisible();
    expect(within(card).getByRole("link", { name: "Add" })).toHaveAttribute(
      "href",
      "/trip?add=1#add-a-booking",
    );
    // One group draws no group heading.
    expect(within(card).queryByText("Asked for this trip")).toBeNull();
  });

  it("keeps the names but draws no offer for a role that may not act on the wait list", () => {
    renderCard({ canOffer: false });
    expect(screen.getByText("Ravi Menon")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Ravi Menon/ })).toBeNull();
  });

  it("on a full trip, still shows who waits and the booking link, with no way to add", () => {
    renderCard({ heading: "Who wants in · 1", addHref: null });
    const card = screen.getByRole("region", { name: "Who wants in · 1" });
    expect(within(card).getByText("Ravi Menon")).toBeVisible();
    expect(within(card).queryByText("Add a guest yourself")).toBeNull();
    expect(within(card).getByRole("button", { name: "Copy link" })).toBeVisible();
  });

  it("folds the past guests behind one Invite row", () => {
    renderCard({
      pastGuests: { count: 4, line: "Dived Blue Hole before", list: <p>Ana Ruiz</p> },
    });
    expect(screen.getByText("4 past guests")).toBeVisible();
    expect(screen.getByText("Invite")).toBeVisible();
  });
});
