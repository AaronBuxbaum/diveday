// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";
import { diverTranslator } from "@/i18n/messages";
import { type ReadyThreadSectionsContext, ThreadSections } from "./ThreadSections";

const seen = vi.hoisted(() => ({
  arrival: null as Record<string, unknown> | null,
  packing: null as Record<string, unknown> | null,
  party: null as Record<string, unknown> | null,
}));

vi.mock("../booking-actions", () => ({
  cancelMyBookingAction: async () => {},
  addSeatFromReady: async () => {},
  payForPartySeatFromReady: async () => {},
  askToMoveAction: async () => {},
}));
vi.mock("./RunningLate", () => ({ RunningLate: () => <p>late</p> }));
vi.mock("./CourseMaterials", () => ({ CourseMaterials: () => <p>materials</p> }));
vi.mock("@/components/TripArrivalCard", () => ({
  TripArrivalCard: (props: Record<string, unknown>) => {
    seen.arrival = props;
    return <p>arrival</p>;
  },
}));
vi.mock("@/app/s/[shopSlug]/trips/[id]/_components/TripCrewLine", () => ({
  TripCrewLine: () => <p>crew</p>,
}));
vi.mock("@/components/TripChangeLedger", () => ({ TripChangeLedger: () => <p>ledger</p> }));
vi.mock("@/components/PartyClaimPanel", () => ({
  PartyClaimPanel: (props: Record<string, unknown>) => {
    seen.party = props;
    return <p>party</p>;
  },
}));
vi.mock("@/app/s/[shopSlug]/trips/[id]/_components/PackingSection", () => ({
  PackingSection: (props: Record<string, unknown>) => {
    seen.packing = props;
    return <p>packing</p>;
  },
}));

const t = diverTranslator("en-US");

afterEach(() => {
  cleanup();
  seen.arrival = null;
  seen.packing = null;
  seen.party = null;
});

function context(over: Partial<ReadyThreadSectionsContext> = {}): ReadyThreadSectionsContext {
  return {
    token: "tok",
    data: {
      detail: {
        trip: { title: "Two-Tank Reef" },
        shop: { name: "Blue Mantis Divers", timezone: "America/New_York" },
      },
      shop: { dockCallMinutes: 30 },
      trip: { id: "trip-1" },
      pickupTime: null,
      rentalFit: null,
      canCancelBooking: true,
      cancelPreview: "none",
      meetingDayCount: 1,
    } as unknown as ReadyPageData,
    locale: "en-US",
    t,
    fullShop: {
      name: "Blue Mantis Divers",
      slug: "blue-mantis",
      timezone: "America/New_York",
      contactPhone: null,
      contactEmail: null,
      addressStreet: "1 Dock St",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      addressPostalCode: "33037",
      addressCountry: "US",
    } as unknown as ReadyThreadSectionsContext["fullShop"],
    fullTrip: { id: "trip-1" } as unknown as ReadyThreadSectionsContext["fullTrip"],
    tripDives: [
      {
        diveSite: { name: "Molasses", expectedBottomTimeMinutes: 45 },
        dive: { travelMinutes: 20 },
      },
      { diveSite: null, dive: { travelMinutes: 15 } },
    ] as unknown as ReadyThreadSectionsContext["tripDives"],
    changeEvents: [],
    publicCrew: [],
    partySeatClaims: [],
    partyAllSet: false,
    flySafePlan: null,
    ...over,
  };
}

describe("ThreadSections", () => {
  it("keeps the paid-seat forfeit and submitted move receipt on paper", () => {
    const paid = context();
    Object.assign(paid.data, {
      cancelPreview: "forfeit",
      moveAsk: { note: "Any Saturday", sentAt: new Date("2026-07-21T13:30:00Z") },
    });
    render(<ThreadSections context={paid} />);
    const receipt = screen.getByText("Any Saturday");
    const unchanged = screen.getByText(t("ready.moveAsk.bookingUnchanged"));
    const preview = screen.getByText(t("ready.cancelPreviewForfeit"));
    for (const fact of [receipt, unchanged, preview]) {
      expect(fact.closest('[class~="print:hidden"]')).toBeNull();
    }
    expect(
      screen
        .getByRole("button", { name: t("ready.cancelSpot") })
        .closest('[class~="print:hidden"]'),
    ).not.toBeNull();
  });
  it("runs where to go, the crew, the ledger, the packing list, then the cancel door", () => {
    const { container } = render(<ThreadSections context={context()} />);
    const text = container.textContent ?? "";
    const order = ["late", "arrival", "crew", "ledger", "materials", "packing"].map((word) =>
      text.indexOf(word),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByRole("button", { name: t("ready.cancelSpot") })).toBeTruthy();
  });

  // Issue #2795: a course session's own afternoon, under the packing list.
  it("lays out a course session's afternoon under the packing list, and nothing on a charter", () => {
    const { container } = render(
      <ThreadSections
        context={context({
          fullShop: {
            ...context().fullShop,
            depthUnit: "meters",
          } as unknown as ReadyThreadSectionsContext["fullShop"],
          fullTrip: {
            id: "trip-1",
            course: {
              gearIncluded: true,
              scheduleDays: [{ title: "Your afternoon", items: ["Confined water skills"] }],
            },
          } as unknown as ReadyThreadSectionsContext["fullTrip"],
        })}
      />,
    );
    const text = container.textContent ?? "";
    expect(screen.getByRole("region", { name: "Your afternoon" })).toBeTruthy();
    expect(text.indexOf("packing")).toBeLessThan(text.indexOf("Confined water skills"));
    cleanup();
    render(<ThreadSections context={context()} />);
    expect(screen.queryByTestId("ready-session-day")).toBeNull();
  });

  it("names the planned sites in order, and leaves the dock call to the masthead (ideas item 23)", () => {
    render(<ThreadSections context={context()} />);
    expect(seen.arrival?.sites).toEqual(["Molasses"]);
    expect(seen.arrival).not.toHaveProperty("dockCallMinutes");
    expect(seen.arrival?.downloadHref).toContain("?booking=tok");
    expect(seen.packing?.siteBottomTimes).toEqual([45, undefined]);
    expect(seen.packing?.legTravelTimes).toEqual([20, 15]);
  });

  it("says when to fly home as a plan, and nothing when there is no plan (ideas item 18)", () => {
    render(<ThreadSections context={context()} />);
    expect(screen.queryByTestId("ready-fly-safe-plan")).toBeNull();
    cleanup();
    render(
      <ThreadSections
        context={context({
          flySafePlan: {
            from: new Date("2026-10-16T08:30:00.000Z"),
            reason: "dives_planned",
            hours: 24,
          },
        })}
      />,
    );
    expect(screen.getByTestId("ready-fly-safe-plan").textContent).toMatch(
      /^Flying home soon\? Blue Mantis Divers asks you to plan your flight no earlier than Fri, Oct\s16, 4:30\sAM\sEDT: we plan more than one dive, so 24 hours after we’re due back, plus an hour in case we run late, following DAN’s guidance, and longer if you make decompression stops\.$/,
    );
  });

  it("shows the party panel only to a party lead, with its all-set close", () => {
    render(<ThreadSections context={context()} />);
    expect(screen.queryByText("party")).toBeNull();
    cleanup();
    render(
      <ThreadSections
        context={context({
          partySeatClaims: [
            {
              bookingId: "b2",
              seatName: "Sam",
              claimed: true,
              waiverSigned: true,
              claim: { token: "claim-token" },
            },
          ] as unknown as ReadyThreadSectionsContext["partySeatClaims"],
          partyAllSet: true,
        })}
      />,
    );
    expect(screen.getByText("party")).toBeTruthy();
    expect(screen.getByText(t("thread.partyAllSet"))).toBeTruthy();
    const seats = seen.party?.seats as Array<{ claimUrl: string }>;
    expect(seats[0].claimUrl).toContain("claim-token");
  });

  it("lists which party seats go with the lead and which stay, inside the confirm (batch 6 item 10)", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(
      <ThreadSections
        context={context({
          partySeatClaims: [
            { bookingId: "b2", seatName: "Milo", claimed: false, cancelsWithLead: true },
            { bookingId: "b3", seatName: "Pia", claimed: true, cancelsWithLead: false },
          ] as unknown as ReadyThreadSectionsContext["partySeatClaims"],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("ready.cancelSpot") }));
    const plan = screen.getByTestId("party-cancel-plan");
    expect(plan.textContent).toContain(t("ready.cancelPartyGoes", { names: "Milo" }));
    expect(plan.textContent).toContain(t("ready.cancelPartyStays", { count: 1, names: "Pia" }));
    expect(screen.getByText(t("ready.cancelConfirmParty", { trip: "Two-Tank Reef" }))).toBeTruthy();
  });

  it("offers no cancel door the booking would refuse, and nothing without the trip on record", () => {
    const closed = context({ fullShop: undefined, fullTrip: null });
    (closed.data as unknown as { canCancelBooking: boolean }).canCancelBooking = false;
    render(<ThreadSections context={closed} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("arrival")).toBeNull();
    expect(screen.queryByText("packing")).toBeNull();
  });

  /** H-20261014-ask-to-move: past the free window, the ask comes before the forfeit. */
  it("offers Ask to move above the cancel once a cancel would forfeit, with the shop's phone", () => {
    const past = context({
      fullShop: {
        name: "Blue Mantis Divers",
        contactPhone: "+1 305-555-0100",
      } as unknown as ReadyThreadSectionsContext["fullShop"],
    });
    Object.assign(past.data, { moveAsk: "open", cancelPreview: "forfeit" });
    const { container } = render(<ThreadSections context={past} />);
    expect(
      screen.getByText(
        "Can’t make this date? Ask Blue Mantis Divers to move you to another one, or call +1 305-555-0100.",
      ),
    ).toBeTruthy();
    const ask = screen.getByRole("button", { name: "Ask to move" });
    const cancel = screen.getByRole("button", { name: t("ready.cancelSpot") });
    expect(ask.closest('[class~="print:hidden"]')).not.toBeNull();
    expect(cancel.closest('[class~="print:hidden"]')).not.toBeNull();
    expect(ask.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('input[name="note"]')).toBeTruthy();
  });

  it("says the ask was sent instead of offering it twice, and shows nothing before the window closes", () => {
    const asked = context();
    Object.assign(asked.data, {
      moveAsk: { note: "Any Saturday", sentAt: new Date("2026-07-21T13:30:00Z") },
    });
    render(<ThreadSections context={asked} />);
    expect(screen.getByText(t("ready.moveAsk.asked", { shop: "Blue Mantis Divers" }))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask to move" })).toBeNull();
    cleanup();
    const early = context();
    Object.assign(early.data, { moveAsk: null });
    render(<ThreadSections context={early} />);
    expect(screen.queryByRole("button", { name: "Ask to move" })).toBeNull();
  });
});
