// i18n-exempt-file: test fixture; only the roster's tests import it, and its names are seeded data.
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AboardHold } from "@/db/aboard-at-sea";
import type { SameNameHeldSeat } from "@/db/bookings";
import type { SameNamePerson } from "@/db/identity-repoint";
import { DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { signingDate } from "@/lib/guardian";
import { PAPER_WAIVER_IDLE } from "@/lib/paper-waiver-form";
import type { RosterRowContext } from "./RosterRow";
import { type RosterArrival, RosterSection } from "./RosterSection";
import {
  type RosterRecord,
  rosterPaymentStatusCopy,
  type SeatMove,
  waiverControls,
} from "./roster-model";
import { type RosterSeat, rosterSeat } from "./roster-seat";
import type {
  NitroxByBooking,
  ReadinessByBooking,
  RentalFitByBooking,
  RosterEntry,
  WaiverByBooking,
} from "./types";

/**
 * **One departure's roster, drawn the way the guests ledger draws it** — the
 * fixtures every roster test file renders through, so a seat's parts are
 * each tested in their own file against the same section.
 */

export const noop = () => {};
/** The paper-waiver door is a `useActionState` reducer (issue #1674). */
export const noRefusal = async () => PAPER_WAIVER_IDLE;

export function entry(
  id: string,
  fullName: string,
  over: {
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    dateOfBirth?: string;
    reEntryAsk?: "deck_word" | "easy_first_dive" | "refresher_course";
    identityBookedAs?: string;
    identityMatchedBy?: "shared_email" | "picked_name";
    participantType?: "diver" | "snorkeler" | "rider";
  } = {},
): RosterEntry {
  return {
    booking: {
      id,
      status: "booked",
      diveIntent: null,
      reEntryAsk: over.reEntryAsk ?? null,
      lastDivedBand: null,
      hotelPickupLocation: null,
      pickupTime: null,
      identityBookedAs: over.identityBookedAs ?? null,
      identityMatchedBy: over.identityMatchedBy ?? null,
      participantType: over.participantType ?? "diver",
    } as unknown as RosterEntry["booking"],
    person: {
      id: `p-${id}`,
      fullName,
      email: `${id}@example.com`,
      dateOfBirth: over.dateOfBirth ?? null,
      emergencyContactName: over.emergencyContactName ?? "Ada Contact",
      emergencyContactPhone: over.emergencyContactPhone ?? "+1 555 0100",
    } as unknown as RosterEntry["person"],
  };
}

export const signedWaiver = {
  waiver: {
    id: "w-1",
    status: "completed",
    completedAt: new Date("2026-08-20T15:00:00Z"),
    signatureMethod: "digital",
    expiresAt: new Date("2027-08-20T15:00:00Z"),
    medicalAnswers: null,
  },
} as unknown as WaiverByBooking extends Map<string, infer V> ? V : never;

export function readinessRow(status: "ready" | "blocked", blockers: unknown[] = []) {
  return {
    readiness: { status, blockers },
    paymentStatus: "paid",
    paymentProvider: null,
    depthAdvisory: null,
  } as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;
}

/** A blocked seat whose site also runs deeper than its card, which a boat can share. */
export function deepRow() {
  return {
    ...readinessRow("blocked", [{ code: "certification_missing", params: undefined }]),
    depthAdvisory: {
      status: "exceeds",
      limitDepth: 18,
      siteDepth: 30,
      unit: "meters",
      basis: "certification",
      level: "open_water",
    },
  } as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;
}

/** What `renderRoster` draws, and `seatFacts` reads, built from one set of options. */
export type RosterFixtureOptions = {
  roster: RosterEntry[];
  readiness: ReadinessByBooking;
  waivers: WaiverByBooking;
  rentalFit?: RentalFitByBooking;
  addDiverGroup?: ReactNode;
  paymentsConnected?: boolean;
  canManageOrders?: boolean;
  requiresPayment?: boolean;
  arrival?: RosterArrival;
  record?: RosterRecord;
  sameNameHeldSeats?: ReadonlyMap<string, ReadonlyArray<SameNameHeldSeat>>;
  sameNamePeople?: ReadonlyMap<string, ReadonlyArray<SameNamePerson>>;
  dependentCharters?: ReadonlyMap<string, ReadonlyArray<{ title: string; startsAt: Date }>>;
  heldSeatLastDiveDay?: ReadonlyMap<string, Date | null>;
  packageDivesByBooking?: ReadonlyMap<string, number>;
  splitAsksDateOfBirth?: boolean;
  /** Present means this is a course session's roster, with a Certify control. */
  certifyDefaultLevel?: "open_water" | "advanced_open_water" | null;
  /** "Move to another departure", when the page offers it. */
  moveSeat?: SeatMove;
  /** Seats marked aboard a boat that has left, whose Remove refuses (H-20261015-aboard-diver-removal-at). */
  aboardAtSea?: ReadonlyMap<string, AboardHold>;
  /** The departure is marked as past no-decompression limits. */
  exceedsNoDecoLimits?: boolean;
  divingCrew?: boolean;
};

function rosterProps({
  roster,
  readiness,
  waivers,
  rentalFit,
  addDiverGroup,
  paymentsConnected = false,
  canManageOrders = true,
  requiresPayment = false,
  arrival,
  record,
  sameNameHeldSeats,
  sameNamePeople,
  dependentCharters,
  heldSeatLastDiveDay,
  packageDivesByBooking,
  splitAsksDateOfBirth,
  certifyDefaultLevel,
  moveSeat,
  aboardAtSea,
  exceedsNoDecoLimits,
  divingCrew,
}: RosterFixtureOptions) {
  return {
    trip: {
      shopSlug: "blue-mantis",
      shopTimezone: "America/New_York",
      // The source locale: these tests read the English bundle.
      locale: DIVER_LOCALES[0],
      tripId: "trip-1",
      booked: roster.length,
      capacity: 12,
      tripDate: "2026-08-28",
      requiresPayment,
      paymentsConnected,
      cancellationDeadline: null,
      mayWriteOffPayment: false,
      canManageOrders,
      splitAsksDateOfBirth,
      certifyDefaultLevel,
      exceedsNoDecoLimits,
      divingCrew,
    },
    rows: {
      roster,
      readinessByBooking: readiness,
      waiverByBooking: waivers,
      rentalFitByBooking: rentalFit ?? (new Map() as RentalFitByBooking),
      nitroxByBooking: new Map() as NitroxByBooking,
      notesByBooking: new Map(),
      sameNameHeldSeats,
      sameNamePeople,
      dependentCharters,
      heldSeatLastDiveDay,
      packageDivesByBooking,
      aboardAtSea,
    },
    actions: {
      markRosterWaiverInPersonAction: noRefusal,
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
      certifyDiverAction: certifyDefaultLevel === undefined ? undefined : noop,
      moveSeat,
    },
    slots: { addDiverGroup, arrival, record },
  };
}

export function renderRoster(options: RosterFixtureOptions) {
  return render(<RosterSection {...rosterProps(options)} />);
}

/**
 * **One seat's own facts, the first link of `RosterRow`'s builder chain and
 * nothing after it**, read through the same context `RosterSection` hands every
 * row. A builder's test spreads this and adds only the fields its `Pick` names
 * from an earlier builder, so it never runs the chain to reach one input.
 */
export function seatFacts(
  rosterEntry: RosterEntry,
  options: Omit<RosterFixtureOptions, "roster"> & { settled?: boolean },
): RosterSeat {
  const { trip, rows, actions, slots } = rosterProps({ ...options, roster: [rosterEntry] });
  const t = staffTranslator(trip.locale);
  const context: RosterRowContext = {
    t,
    trip,
    rows,
    actions,
    arrival: slots.arrival,
    record: Boolean(slots.record),
    sharedAdvisoryTexts: new Set(),
    waiverControls: waiverControls(t),
    paymentStatusCopy: rosterPaymentStatusCopy(t),
    refundEligible: false,
    signedToday: signingDate(nowDate(), trip.shopTimezone),
    offersCreateOrder: trip.paymentsConnected && trip.canManageOrders,
  };
  return rosterSeat(rosterEntry, options.settled ?? false, context);
}

export const blocked = entry("a", "Asha Osei");
export const ready = entry("b", "Rene Marsh");
export const fixtures = {
  roster: [blocked, ready],
  readiness: new Map([
    ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
    ["b", readinessRow("ready")],
  ]) as ReadinessByBooking,
  waivers: new Map([
    ["a", signedWaiver],
    ["b", signedWaiver],
  ]) as WaiverByBooking,
};
