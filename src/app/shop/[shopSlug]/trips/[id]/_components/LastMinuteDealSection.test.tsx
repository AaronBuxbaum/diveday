// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripLastMinutePromo } from "@/db/schema";
import { LastMinuteDealSection } from "./LastMinuteDealSection";

afterEach(cleanup);

function promo(over: Partial<TripLastMinutePromo> = {}): TripLastMinutePromo {
  return {
    id: "promo-1",
    code: "SAVE25-A1B2",
    status: "sent",
    recipientCount: 12,
    discountPercent: 25,
    discountAmountCents: null,
    createdAt: new Date("2026-10-20T15:00:00Z"),
    ...over,
  } as TripLastMinutePromo;
}

function renderSection(props: Partial<Parameters<typeof LastMinuteDealSection>[0]> = {}) {
  return render(
    <LastMinuteDealSection
      tripPath="/shop/blue-mantis/trips/trip-1"
      promos={[promo()]}
      timezone="America/New_York"
      locale="en-US"
      {...props}
    />,
  );
}

/**
 * The Details tab keeps the deals this departure sent and a door to the Divers
 * tab's panel; the sender, its recipient list and its hold live there
 * (`WhoWantsInPanel`).
 */
describe("LastMinuteDealSection", () => {
  it("lists the deals sent: the discount, the code and how it ended", () => {
    renderSection({
      promos: [
        promo(),
        promo({ id: "promo-2", code: "SAVE30-C3D4", status: "failed", discountPercent: 30 }),
      ],
    });
    expect(screen.getByText(/25% off/)).toBeInTheDocument();
    expect(screen.getByText("SAVE25-A1B2")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("Failed at Stripe")).toBeInTheDocument();
  });

  it("links to the panel to send another, and carries no sender of its own", () => {
    renderSection();
    expect(screen.getByRole("link", { name: "Offer a seat with a discount" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1#who-wants-in",
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("draws no link when nothing can be offered (full or canceled)", () => {
    renderSection({ tripPath: null });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says the lead time line it is handed, ahead of the link", () => {
    renderSection({
      leadTime: <p>Saturday departures usually sell 40% of their seats in the last 3 days.</p>,
    });
    const line = screen.getByText(/usually sell 40%/);
    const link = screen.getByRole("link", { name: "Offer a seat with a discount" });
    expect(line.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
