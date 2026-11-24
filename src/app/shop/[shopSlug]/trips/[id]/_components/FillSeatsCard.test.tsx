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

  it("opens the add form first in the card, under the guests it adds to", () => {
    renderCard({ addForm: <p>the add form</p> });
    const card = screen.getByRole("region", { name: "Fill the last 2" });
    const rows = within(card).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Add a guest yourself");
    expect(within(rows[0] as HTMLElement).getByText("the add form")).toBeVisible();
    // The form is the add: its row draws no second Add.
    expect(within(card).queryByRole("link", { name: "Add" })).toBeNull();
  });

  it("words the add row as the caller says (sold elsewhere: type or paste)", () => {
    renderCard({
      heading: "Add guests",
      groups: [],
      bookingLink: false,
      addLabel: "Type them in, or paste your list",
    });
    const card = screen.getByRole("region", { name: "Add guests" });
    expect(within(card).getByText("Type them in, or paste your list")).toBeVisible();
    expect(within(card).queryByText("Add a guest yourself")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("folds the past guests and the booking link behind one Share row", () => {
    const { container } = renderCard({ pastGuests: { count: 4, list: <p>Ana Ruiz</p> } });
    const share = container.querySelector("details.group\\/share");
    if (!(share instanceof HTMLDetailsElement)) throw new Error("no Share disclosure");
    expect(within(share).getByText("Share")).toBeVisible();
    expect(within(share).getByText("Invite 4 past guests, or copy the booking link")).toBeVisible();
    // Both controls live inside it, and nowhere else in the card.
    expect(share.open).toBe(false);
    expect(within(share).getByText("Ana Ruiz")).toBeInTheDocument();
    expect(within(share).getByRole("button", { name: "Copy link", hidden: true })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Copy link", hidden: true })).toHaveLength(1);
  });

  it("opens Share when the page lands on #invite-suggestions (Today's Invite past divers)", () => {
    window.location.hash = "#invite-suggestions";
    const { container } = renderCard({ pastGuests: { count: 4, list: <p>Ana Ruiz</p> } });
    expect(container.querySelector<HTMLDetailsElement>("details.group\\/share")?.open).toBe(true);
    window.location.hash = "";
  });

  it("leaves the booking link a plain row when there is nobody to invite, or no leave to", () => {
    const { container } = renderCard();
    expect(container.querySelector("details.group\\/share")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeVisible();
    cleanup();
    renderCard({ canOffer: false, pastGuests: { count: 4, list: <p>Ana Ruiz</p> } });
    expect(screen.queryByText("Share")).toBeNull();
    expect(screen.queryByText("Ana Ruiz")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeVisible();
  });
});

describe("Offer seats, in the fill card", () => {
  const batch = {
    interests: [{ interestId: "i1", name: "Ravi Menon", email: "i1@example.com" }],
    names: "Ravi Menon gets the booking link by email.",
    send: "Send the offer",
    next: "Offer the next in line",
  };

  it("names the batch behind a closed disclosure, which #offer-seats opens", () => {
    const { container } = renderCard({
      bulk: { batch, summary: "Offer the first in line a seat" },
    });
    const bulk = container.querySelector<HTMLDetailsElement>("details#offer-seats");
    expect(bulk?.open).toBe(false);
    expect(screen.getByText("Offer the first in line a seat")).toBeVisible();
    cleanup();
    window.location.hash = "#offer-seats";
    const again = renderCard({ bulk: { batch, summary: "Offer the first in line a seat" } });
    expect(again.container.querySelector<HTMLDetailsElement>("details#offer-seats")?.open).toBe(
      true,
    );
    expect(screen.getByText(batch.names)).toBeVisible();
    expect(screen.getByRole("button", { name: "Send the offer" })).toBeEnabled();
    window.location.hash = "";
  });

  it("draws no batch with nobody to offer", () => {
    const { container } = renderCard();
    expect(container.querySelector("#offer-seats")).toBeNull();
  });
});
