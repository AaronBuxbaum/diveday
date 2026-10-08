// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
      markWaiverInPersonAction: async () => PAPER_WAIVER_IDLE,
      markPaymentAction: noop,
      removeBookingAction: noop,
      confirmIdentityAction: noop,
      splitIdentityAction: noop,
      addNoteAction: noop,
      deleteNoteAction: noop,
      saveEmergencyContactAction: noop,
    },
    arrival: undefined,
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
});

/**
 * The learning-materials tick (ADR 20261008-course-learning-materials): a
 * capsule on the name line while nobody has ticked it, and one form that
 * posts the opposite of what is stored.
 */
describe("RosterRow learning materials", () => {
  function courseContext(): RosterRowContext {
    const base = contextFor("ready");
    return {
      ...base,
      trip: { ...base.trip, courseHasMaterials: true },
      actions: { ...base.actions, setCourseMaterialsDoneAction: noop },
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
