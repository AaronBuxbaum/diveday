// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { PAPER_WAIVER_IDLE } from "@/lib/paper-waiver-form";
import { RosterRow, type RosterRowContext } from "./RosterRow";
import { rosterPaymentStatusCopy, waiverControls } from "./roster-model";
import type {
  NitroxByBooking,
  ReadinessByBooking,
  RentalFitByBooking,
  RosterEntry,
  WaiverByBooking,
} from "./types";

afterEach(cleanup);

// A stateful result isolates whether the parent preserves the real send control's identity.
vi.mock("@/app/shop/[shopSlug]/_components/today/WaiverSendControl", async () => {
  const { useState } = await import("react");
  return {
    WaiverSendControl: ({ label }: { label: string }) => {
      const [done, setDone] = useState(false);
      return (
        <button type="button" onClick={() => setDone(true)}>
          {done ? "Copy link" : label}
        </button>
      );
    },
  };
});

const noop = () => {};
const t = staffTranslator("en-US");

const seat = {
  booking: {
    id: "b-1",
    status: "booked",
    diveIntent: null,
    reEntryAsk: null,
    lastDivedBand: null,
    hotelPickupLocation: null,
    pickupTime: null,
    identityBookedAs: null,
    identityMatchedBy: null,
  } as unknown as RosterEntry["booking"],
  person: {
    id: "p-1",
    fullName: "Asha Osei",
    email: "asha@example.com",
    dateOfBirth: null,
    emergencyContactName: "Ada Contact",
    emergencyContactPhone: "+1 555 0100",
  } as unknown as RosterEntry["person"],
} satisfies RosterEntry;

function contextFor(status: "ready" | "blocked"): RosterRowContext {
  const readinessRow = {
    readiness: {
      status,
      blockers: status === "blocked" ? [{ code: "certification_missing", params: undefined }] : [],
    },
    paymentStatus: "paid",
    paymentProvider: null,
    depthAdvisory: null,
  };
  return {
    t,
    trip: {
      shopSlug: "blue-mantis",
      shopTimezone: "America/New_York",
      locale: "en-US",
      tripId: "trip-1",
      booked: 1,
      capacity: 12,
      tripDate: "2026-08-28",
      requiresPayment: false,
      paymentsConnected: false,
      cancellationDeadline: null,
      mayWriteOffPayment: false,
      canManageOrders: true,
    },
    rows: {
      roster: [seat],
      readinessByBooking: new Map([["b-1", readinessRow]]) as unknown as ReadinessByBooking,
      waiverByBooking: new Map() as WaiverByBooking,
      rentalFitByBooking: new Map() as RentalFitByBooking,
      nitroxByBooking: new Map() as NitroxByBooking,
      notesByBooking: new Map(),
    },
    actions: {
      markRosterWaiverInPersonAction: async () => PAPER_WAIVER_IDLE,
      markPaymentAction: noop,
      previewPartyPaymentAction: noop,
      markPartyPaidAction: noop,
      removeBookingAction: noop,
      confirmIdentityAction: noop,
      splitIdentityAction: noop,
      repointIdentityAction: noop,
      addNoteAction: noop,
      deleteNoteAction: noop,
      saveEmergencyContactAction: noop,
    },
    arrival: undefined,
    record: false,
    sharedAdvisoryTexts: new Set(),
    waiverControls: waiverControls(t),
    paymentStatusCopy: rosterPaymentStatusCopy(t),
    refundEligible: false,
    signedToday: "2026-08-28",
    offersCreateOrder: false,
  };
}

describe("RosterRow", () => {
  it("draws one seat as a deep-linkable list item under its diver's name", () => {
    const { container } = render(
      <ul>
        <RosterRow entry={seat} settled={false} context={contextFor("blocked")} />
      </ul>,
    );
    expect(container.querySelector("li#booking-b-1")).not.toBeNull();
    expect(screen.getAllByText("Asha Osei").length).toBeGreaterThan(0);
  });

  it("wears the drawn mark when filed under a settled group", () => {
    const { container } = render(
      <ul>
        <RosterRow entry={seat} settled context={contextFor("ready")} />
      </ul>,
    );
    expect(container.querySelector("#booking-b-1 summary svg")).not.toBeNull();
  });

  /**
   * **A finished departure's row is a record** (UX review 2026-10-10, item
   * 10): the blocked diver who did not sail is listed, not chased. No
   * "Blocked" capsule and no reason line asking for a fix.
   */
  it("in the record, names the diver and asks for nothing", () => {
    render(
      <ul>
        <RosterRow
          entry={seat}
          settled={false}
          context={{ ...contextFor("blocked"), record: true }}
        />
      </ul>,
    );
    expect(screen.getAllByText("Asha Osei").length).toBeGreaterThan(0);
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("outside the record, still says Blocked", () => {
    render(
      <ul>
        <RosterRow entry={seat} settled={false} context={contextFor("blocked")} />
      </ul>,
    );
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });
});

/**
 * The learning-materials tick (ADR 20261008-course-learning-materials): a
 * capsule on the name line while nobody has ticked it, and one form that
 * posts the opposite of what is stored.
 */
describe("RosterRow learning materials", () => {
  function courseContext(over: { open?: boolean } = {}): RosterRowContext {
    const base = contextFor("ready");
    return {
      ...base,
      trip: { ...base.trip, courseHasMaterials: true, courseMaterialsOpen: over.open ?? true },
      actions: {
        ...base.actions,
        setCourseMaterialsDoneAction: noop,
        certifyDiverAction: noop,
      },
    };
  }
  const withTick = (at: Date | null) => ({
    ...seat,
    booking: { ...seat.booking, courseMaterialsDoneAt: at } as RosterEntry["booking"],
  });
  const doneField = (container: HTMLElement) =>
    container.querySelector<HTMLInputElement>('#booking-b-1 input[name="done"]')?.value;

  it("says who has not finished, and offers to mark it done", () => {
    const { container } = render(
      <ul>
        <RosterRow entry={withTick(null)} settled={false} context={courseContext()} />
      </ul>,
    );
    expect(screen.getAllByText("Materials not done").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Mark materials done" })).toBeInTheDocument();
    expect(doneField(container)).toBe("true");
    expect(
      container.querySelector<HTMLInputElement>('#booking-b-1 input[name="bookingId"]')?.value,
    ).toBe("b-1");
  });

  it("names the day it was ticked, and the same form takes it back", () => {
    const { container } = render(
      <ul>
        <RosterRow
          entry={withTick(new Date("2026-08-20T15:00:00Z"))}
          settled={false}
          context={courseContext()}
        />
      </ul>,
    );
    expect(screen.queryByText("Materials not done")).toBeNull();
    expect(screen.getByText(/Materials done · Thu,\sAug\s20/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark not done" })).toBeInTheDocument();
    expect(doneField(container)).toBe("false");
  });

  it("names who ticked it, read from the person's tick on any departure", () => {
    const context = courseContext();
    const { container } = render(
      <ul>
        <RosterRow
          entry={withTick(null)}
          settled={false}
          context={{
            ...context,
            rows: {
              ...context.rows,
              courseMaterialsDoneByPerson: new Map([
                [
                  "p-1",
                  { at: new Date("2026-08-20T15:00:00Z"), byPersonId: "s-1", byName: "Ana Ruiz" },
                ],
              ]),
            },
          }}
        />
      </ul>,
    );
    expect(screen.queryByText("Materials not done")).toBeNull();
    expect(screen.getByText(/Materials done · Thu,\sAug\s20 · Ana Ruiz/)).toBeInTheDocument();
    expect(doneField(container)).toBe("false");
  });

  it("drops the capsule once the session has ended, and keeps the tick", () => {
    const { container } = render(
      <ul>
        <RosterRow
          entry={withTick(null)}
          settled={false}
          context={courseContext({ open: false })}
        />
      </ul>,
    );
    expect(screen.queryByText("Materials not done")).toBeNull();
    expect(doneField(container)).toBe("true");
  });

  it("notes a missing tick beside Certify without blocking it", () => {
    render(
      <ul>
        <RosterRow entry={withTick(null)} settled={false} context={courseContext()} />
      </ul>,
    );
    expect(
      screen.getByText("Materials not marked done; check the agency’s record before certifying.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("says nothing beside Certify once the materials are done", () => {
    const { container } = render(
      <ul>
        <RosterRow
          entry={withTick(new Date("2026-08-20T15:00:00Z"))}
          settled={false}
          context={courseContext()}
        />
      </ul>,
    );
    expect(container.textContent).not.toContain("Materials not marked done");
  });

  it("draws nothing for a course with no materials", () => {
    const base = contextFor("ready");
    const { container } = render(
      <ul>
        <RosterRow entry={withTick(null)} settled={false} context={base} />
      </ul>,
    );
    expect(screen.queryByText("Materials not done")).toBeNull();
    expect(doneField(container)).toBeUndefined();
  });
});

/**
 * **Mark the party paid** is drawn on a lead's seat only while two or more
 * seats of the party still owe money and none was paid online (issue #2605).
 */
describe("RosterRow party payment", () => {
  const friend = {
    booking: { ...seat.booking, id: "b-2", partyLeadBookingId: "b-1" },
    person: { ...seat.person, id: "p-2", fullName: "Ada Osei" },
  } as unknown as RosterEntry;

  function partyContext(options: { friendOwes?: number | null; friendProvider?: string | null }) {
    const context = contextFor("ready");
    const row = (provider: string | null) => ({
      readiness: { status: "ready", blockers: [] },
      paymentStatus: "unpaid",
      paymentProvider: provider,
      depthAdvisory: null,
    });
    const marks = (owed: number | null) => ({
      shopCurrency: "usd",
      balanceOwedCents: owed,
      mark: null,
    });
    context.trip.requiresPayment = true;
    context.rows.roster = [seat, friend];
    context.rows.readinessByBooking = new Map([
      ["b-1", row(null)],
      ["b-2", row(options.friendProvider ?? null)],
    ]) as unknown as ReadinessByBooking;
    context.rows.paymentMarksByBooking = new Map([
      ["b-1", marks(12_000)],
      ["b-2", marks(options.friendOwes === undefined ? 12_000 : options.friendOwes)],
    ]);
    return context;
  }

  it("is offered on the lead's seat with the party's total", () => {
    render(
      <ul>
        <RosterRow entry={seat} settled={false} context={partyContext({})} />
      </ul>,
    );
    expect(screen.getByTestId("party-payment")).toBeInTheDocument();
    expect(
      screen.getByText("2 seats in this party still owe $240.00 together."),
    ).toBeInTheDocument();
  });

  it("is not offered on a party member's own seat", () => {
    render(
      <ul>
        <RosterRow entry={friend} settled={false} context={partyContext({})} />
      </ul>,
    );
    expect(screen.queryByTestId("party-payment")).toBeNull();
  });

  it("is not offered when only one seat owes, or when a seat that owes was paid online", () => {
    const { rerender } = render(
      <ul>
        <RosterRow entry={seat} settled={false} context={partyContext({ friendOwes: null })} />
      </ul>,
    );
    expect(screen.queryByTestId("party-payment")).toBeNull();
    rerender(
      <ul>
        <RosterRow
          entry={seat}
          settled={false}
          context={partyContext({ friendProvider: "stripe" })}
        />
      </ul>,
    );
    expect(screen.queryByTestId("party-payment")).toBeNull();
  });
});

describe("blockers and information", () => {
  it("preserves the send outcome when revalidation changes the waiver reason to pending", () => {
    const waiverContext = (code: "waiver_not_sent" | "waiver_pending") => {
      const context = contextFor("blocked");
      const existing = context.rows.readinessByBooking.get("b-1");
      if (!existing) throw new Error("missing readiness fixture");
      context.rows.readinessByBooking = new Map([
        [
          "b-1",
          {
            ...existing,
            readiness: { ...existing.readiness, blockers: [{ code }] },
          },
        ],
      ]);
      if (code === "waiver_pending")
        context.rows.waiverByBooking = new Map([
          [
            "b-1",
            {
              waiver: { status: "pending", expiresAt: new Date("2026-12-01T00:00:00Z") },
            },
          ],
        ]) as WaiverByBooking;
      return context;
    };
    const { rerender } = render(
      <RosterRow entry={seat} settled={false} context={waiverContext("waiver_not_sent")} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("trips.roster.waiverSend") }));
    expect(screen.getByRole("button", { name: "Copy link" })).toBeVisible();
    rerender(<RosterRow entry={seat} settled={false} context={waiverContext("waiver_pending")} />);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeVisible();
  });
  it("keeps a certification remedy beside the blocker outside the guest-details fold", () => {
    const { container } = render(
      <ul>
        <RosterRow entry={seat} settled={false} context={contextFor("blocked")} />
      </ul>,
    );
    const remedy = screen.getByRole("link", { name: t("trips.roster.reviewCertificationsLink") });
    expect(remedy.closest("details")).toBeNull();
    expect(remedy).toHaveAttribute("href", "/shop/blue-mantis/divers/p-1#cards");
    expect(container.querySelectorAll('a[href$="#cards"]')).toHaveLength(1);
    expect(screen.getByText(t("trips.roster.cannotBoard"))).toBeInTheDocument();
  });
  it("does not call missing optional contact information a boarding blocker", () => {
    const context = contextFor("ready");
    context.rows.waiverByBooking = new Map([
      ["b-1", { waiver: { status: "completed", completedAt: new Date("2026-08-28T10:00:00Z") } }],
    ]) as WaiverByBooking;
    const contactMissing = {
      ...seat,
      person: { ...seat.person, emergencyContactName: null, emergencyContactPhone: null },
    };
    render(
      <ul>
        <RosterRow entry={contactMissing} settled={false} context={context} />
      </ul>,
    );
    expect(screen.queryByText(t("trips.roster.cannotBoard"))).toBeNull();
    expect(screen.getAllByText(t("trips.roster.informationAndPreparation")).length).toBeGreaterThan(
      0,
    );
  });
});

describe("compact arrivals (issue 3141)", () => {
  it("keeps the no-show action inside details and an actual late-arrival line outside", () => {
    const context = contextFor("ready");
    context.arrival = {
      controls: new Map([
        [
          "b-1",
          <button type="button" key="check">
            Check in
          </button>,
        ],
      ]),
      below: new Map([["b-1", <p key="late">Running late since 7:10</p>]]),
      details: new Map([
        [
          "b-1",
          <button type="button" key="no-show">
            Not here
          </button>,
        ],
      ]),
      boarded: new Set(),
    };
    render(<RosterRow entry={seat} settled context={context} />);
    expect(screen.getByRole("button", { name: "Not here" }).closest("details")).not.toBeNull();
    expect(screen.getByText("Running late since 7:10").closest("details")).toBeNull();
    expect(screen.getByRole("button", { name: "Check in" }).closest("details")).toBeNull();
  });
});
