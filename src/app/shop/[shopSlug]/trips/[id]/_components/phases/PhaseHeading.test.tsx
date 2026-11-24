// @vitest-environment jsdom
// i18n-exempt-file: test fixture names are seeded data.
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { Waitlist } from "../types";
import { PhaseHeading } from "./PhaseHeading";

// The look back's close-out reads the database; Filling never draws it.
vi.mock("./LookBackCloseOut", () => ({ LookBackCloseOut: () => null }));

afterEach(cleanup);

type Props = ComponentProps<typeof PhaseHeading>;
const t = staffTranslator("en-US");

function waiting(id: string, fullName: string, offeredAt: Date | null = null): Waitlist[number] {
  return {
    interest: {
      id,
      askedAt: new Date("2026-11-20T15:00:00Z"),
      askedBy: "diver",
      offeredAt,
      partySize: 1,
      personId: `p-${id}`,
      parentInterestId: null,
    } as unknown as Waitlist[number]["interest"],
    person: { id: `p-${id}`, fullName, email: `${id}@example.com` } as Waitlist[number]["person"],
  };
}

function heading({
  interests = [],
  booked = 4,
  soldElsewhere = false,
  fill = { mayOffer: true },
  cancelled = false,
  seated = [],
}: {
  interests?: Waitlist;
  booked?: number;
  soldElsewhere?: boolean;
  fill?: Props["fill"];
  cancelled?: boolean;
  seated?: string[];
}) {
  return render(
    <PhaseHeading
      frame={
        {
          shown: "filling",
          current: "filling",
          lookBack: false,
          soldElsewhere,
          bar: { booked, capacity: 6 },
          sentence: { headline: "2 seats to fill.", emphasis: null, sub: "4 of 6 booked" },
        } as unknown as Props["frame"]
      }
      guests={
        {
          trip: { capacity: 6, sellableCapacity: 6, booked },
          roster: seated.map((personId) => ({ booking: { personId, status: "confirmed" } })),
          cancelled,
          interests,
          dateInterests: [],
          lastMinute: { recipients: [] },
          certificationSummaries: new Map(),
          dealRequirement: null,
        } as unknown as Props["guests"]
      }
      showDetails={false}
      cancelled={cancelled}
      record={
        {
          context: { shop: { timezone: "America/New_York" } },
          tripId: "trip-1",
          locale: "en-US",
          t,
        } as unknown as Props["record"]
      }
      notBack={0}
      rollCallHero={false}
      tripPath="/shop/blue-mantis/trips/trip-1"
      fill={fill}
      strip={null}
    />,
  );
}

const primary = () => document.querySelector("[data-filling-primary]");

describe("Filling's one primary", () => {
  it("is Offer seats while somebody is in line, opening the batch in the fill card", () => {
    heading({ interests: [waiting("a", "Ravi Menon"), waiting("b", "Hana Kobayashi")] });
    expect(screen.getByRole("link", { name: "Offer seats" })).toHaveAttribute(
      "href",
      "#offer-seats",
    );
    expect(document.querySelectorAll("[data-filling-primary]")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Add a guest" })).toBeNull();
  });

  it("says Offer a seat for a line of one", () => {
    heading({ interests: [waiting("a", "Ravi Menon")] });
    expect(primary()).toHaveTextContent("Offer a seat");
  });

  it("is Add a guest with nobody to offer: an empty line", () => {
    heading({});
    expect(screen.getByRole("link", { name: "Add a guest" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1?phase=filling&add=1#add-a-booking",
    );
    expect(screen.queryByRole("link", { name: /Offer/ })).toBeNull();
  });

  it("is Add a guest once everyone in line was already offered", () => {
    const offered = new Date("2026-11-22T15:00:00Z");
    heading({
      interests: [waiting("a", "Ravi Menon", offered), waiting("b", "Hana Kobayashi", offered)],
    });
    expect(primary()).toHaveTextContent("Add a guest");
  });

  it("is Add a guest when the only one in line already holds a seat here", () => {
    heading({ seated: ["p-a"], interests: [waiting("a", "Ravi Menon")] });
    expect(primary()).toHaveTextContent("Add a guest");
  });

  it("is Add a guest on a trip sold elsewhere, whoever asked for it", () => {
    heading({ soldElsewhere: true, interests: [waiting("a", "Ravi Menon")] });
    expect(primary()).toHaveTextContent("Add a guest");
  });

  it("is Add a guest for a role that may not act on the wait list", () => {
    heading({ fill: { mayOffer: false }, interests: [waiting("a", "Ravi Menon")] });
    expect(primary()).toHaveTextContent("Add a guest");
  });

  it("draws no primary on a full boat that takes no guest, or a cancelled trip", () => {
    heading({ fill: null, interests: [waiting("a", "Ravi Menon")] });
    expect(primary()).toBeNull();
    cleanup();
    heading({ cancelled: true, interests: [waiting("a", "Ravi Menon")] });
    expect(primary()).toBeNull();
  });
});
