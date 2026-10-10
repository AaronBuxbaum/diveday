import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SameNameHeldSeat } from "@/db/bookings";
import { DIVER_LOCALES } from "@/i18n/settings";
import { PAPER_WAIVER_IDLE } from "@/lib/paper-waiver-form";
import { type RosterArrival, RosterSection } from "./RosterSection";
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

export function renderRoster({
  roster,
  readiness,
  waivers,
  rentalFit,
  compact = false,
  addDiverGroup,
  paymentsConnected = false,
  canManageOrders = true,
  requiresPayment = false,
  arrival,
  sameNameHeldSeats,
  heldSeatLastDiveDay,
  packageDivesByBooking,
  splitAsksDateOfBirth,
  certifyDefaultLevel,
}: {
  roster: RosterEntry[];
  readiness: ReadinessByBooking;
  waivers: WaiverByBooking;
  rentalFit?: RentalFitByBooking;
  compact?: boolean;
  addDiverGroup?: ReactNode;
  paymentsConnected?: boolean;
  canManageOrders?: boolean;
  requiresPayment?: boolean;
  arrival?: RosterArrival;
  sameNameHeldSeats?: ReadonlyMap<string, ReadonlyArray<SameNameHeldSeat>>;
  heldSeatLastDiveDay?: ReadonlyMap<string, Date | null>;
  packageDivesByBooking?: ReadonlyMap<string, number>;
  splitAsksDateOfBirth?: boolean;
  /** Present means this is a course session's roster, with a Certify control. */
  certifyDefaultLevel?: "open_water" | "advanced_open_water" | null;
}) {
  return render(
    <RosterSection
      trip={{
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
        compact,
      }}
      rows={{
        roster,
        readinessByBooking: readiness,
        waiverByBooking: waivers,
        rentalFitByBooking: rentalFit ?? (new Map() as RentalFitByBooking),
        nitroxByBooking: new Map() as NitroxByBooking,
        notesByBooking: new Map(),
        sameNameHeldSeats,
        heldSeatLastDiveDay,
        packageDivesByBooking,
      }}
      actions={{
        markWaiverInPersonAction: noRefusal,
        markPaymentAction: noop,
        removeBookingAction: noop,
        confirmIdentityAction: noop,
        splitIdentityAction: noop,
        addNoteAction: noop,
        deleteNoteAction: noop,
        saveEmergencyContactAction: noop,
        certifyDiverAction: certifyDefaultLevel === undefined ? undefined : noop,
      }}
      slots={{ addDiverGroup, arrival }}
    />,
  );
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
