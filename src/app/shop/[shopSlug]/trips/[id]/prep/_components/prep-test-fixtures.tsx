// i18n-exempt-file: test fixtures; the unit labels and names are seeded data a test reads back.

import { render, within } from "@testing-library/react";
import type { TripPrep } from "@/db/trips";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  buildDivePrepChecklist,
  type PrepDiver,
  type PrepGrouping,
  type RentalFit,
} from "@/lib/dive-prep";
import { PrepBody } from "./PrepBody";
import type { PrepView } from "./prep-view";

/**
 * **What the packing list's tests share**: one departure with two divers and a
 * guide, one that opens every panel, a held seat, and the class-list readers
 * the geometry cases use. `PrepBody.test.tsx` renders the whole list; each
 * section's own test renders that section from `viewOf`, the object
 * `PrepBody` hands down.
 */

export const t = staffTranslator(DEFAULT_DIVER_LOCALE);

/** The stack gap both callers pass: a page's sections sit `space-y-10` apart. */
export const STACK = "space-y-10";

/**
 * Two divers and a guide, so the packing half has something real to say: with
 * an empty roster both branches render the same nothing and the cancelled case
 * below would pass for the wrong reason.
 */
export function prepFor(): TripPrep {
  const checklist = buildDivePrepChecklist({
    divers: [
      {
        bookingId: "b1",
        personId: "p1",
        fullName: "Carmen Ruiz",
        fit: {
          bcdSize: "L",
          wetsuitSize: "L",
          bootSize: "10",
          weightKg: 9,
          rentsBcd: true,
          rentsWetsuit: true,
        } as never,
        wantsNitrox: false,
        hasVerifiedNitroxCard: false,
        lastDivedBand: null,
      },
      {
        bookingId: "b2",
        personId: "p2",
        fullName: "Theo Lindqvist",
        fit: null,
        wantsNitrox: false,
        hasVerifiedNitroxCard: false,
        lastDivedBand: null,
      },
    ],
    plannedDives: 2,
    divingCrew: ["Keiko Tanaka"],
  });
  return {
    trip: { id: "t1", capacity: 12, booked: 2 } as TripPrep["trip"],
    checklist,
    hotelPickups: [],
    gearFleetTotal: 0,
    freeByKind: new Map(),
    loadOut: null,
    assignmentRows: [],
    proposals: new Map(),
  };
}

export function withSeats(types: ("diver" | "snorkeler" | "rider")[]): TripPrep {
  const prep = prepFor();
  prep.checklist = buildDivePrepChecklist({
    divers: types.map((participantType, index) => ({
      bookingId: `b${index}`,
      personId: `p${index}`,
      fullName: `Seat ${index}`,
      fit: null,
      participantType,
      wantsNitrox: false,
      hasVerifiedNitroxCard: false,
      lastDivedBand: null,
    })),
    plannedDives: 2,
  });
  return prep;
}

export const STATED = new Date("2026-09-01T00:00:00Z");

/** A stated fit that rents nothing until an override says it does. */
export function statedFit(overrides: Partial<RentalFit> = {}): RentalFit {
  return {
    rentsBcd: false,
    rentsRegulator: false,
    rentsWetsuit: false,
    rentsMask: false,
    rentsFins: false,
    rentsWeights: false,
    rentsDiveComputer: false,
    rentsGopro: false,
    rentsDrysuit: false,
    rentsHood: false,
    rentsGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: null,
    wetsuitSize: null,
    drysuitSize: null,
    hoodSize: null,
    gloveSize: null,
    bootSize: null,
    finSize: null,
    weightPreference: null,
    divesDry: false,
    needsStaffFitAt: null,
    needsStaffFitNote: null,
    fitStatedAt: STATED,
    ...overrides,
  };
}

export function diver(n: number, fullName: string, rest: Partial<PrepDiver> = {}): PrepDiver {
  return {
    bookingId: `b${n}`,
    personId: `p${n}`,
    fullName,
    fit: null,
    wantsNitrox: false,
    hasVerifiedNitroxCard: false,
    lastDivedBand: null,
    ...rest,
  };
}

/**
 * **A departure that opens every panel the list has**: a nitrox blocker, a
 * partial fit, a never-asked diver, a hands-on fit, a hotel pickup, a shared rental line, a diver dry for five years and an
 * assigned unit. The geometry below is about how each of those is drawn, so
 * each one has to be on the page.
 */
export function everyPanelPrep(): TripPrep {
  const checklist = buildDivePrepChecklist({
    divers: [
      diver(1, "Carmen Ruiz", {
        fit: statedFit({
          rentsBcd: true,
          bcdSize: "L",
          rentsWetsuit: true,
          wetsuitSize: "L",
          bootSize: "10",
          rentsRegulator: true,
        }),
        lastDivedBand: "over_five_years",
      }),
      diver(2, "Sam Whitfield", {
        fit: statedFit({
          rentsBcd: true,
          bcdSize: "XL",
          needsStaffFitAt: STATED,
          needsStaffFitNote: "No XL BCD left",
        }),
      }),
      // BCD L beside Carmen, so one rental line is for two divers; no weight
      // stated, so the partial list has a row.
      diver(3, "Grace Mensah", {
        fit: statedFit({ rentsBcd: true, bcdSize: "L", rentsWeights: true }),
      }),
      diver(4, "Theo Lindqvist"),
      diver(5, "Nadia Petrov", { wantsNitrox: true }),
    ],
    plannedDives: 2,
    divingCrew: ["Keiko Tanaka"],
    now: new Date("2026-09-26T12:00:00Z"),
  });
  return {
    trip: { id: "t1", capacity: 12, booked: 5 } as TripPrep["trip"],
    checklist,
    hotelPickups: [
      {
        bookingId: "b1",
        diverName: "Carmen Ruiz",
        hotelPickupLocation: "Harbor Inn",
        pickupTime: "07:15",
      },
    ],
    gearFleetTotal: 4,
    freeByKind: new Map(),
    loadOut: { units: 1, divers: 1, serviceFlagged: 0 },
    assignmentRows: [
      {
        diver: { bookingId: "b1", fullName: "Carmen Ruiz" } as never,
        assigned: [
          {
            reservationId: "r1",
            kind: "bcd",
            size: "L",
            label: "BCD #2",
            checkedOutAt: null,
            status: "in_service",
            serviceNote: null,
            serviceState: { state: "no_clock" },
            serviceConcern: false,
          },
        ] as never,
        wanted: [],
        handedOver: false,
        needsStaffFit: null,
        counterHeld: [],
      },
    ],
    proposals: new Map(),
  };
}

export function heldPrep(): TripPrep {
  const prep = prepFor();
  prep.checklist = buildDivePrepChecklist({
    divers: [
      {
        bookingId: "held",
        personId: "p9",
        fullName: "Tom Marsh",
        fit: null,
        wantsNitrox: true,
        hasVerifiedNitroxCard: false,
        identityHeld: true,
        lastDivedBand: null,
      },
      diver(4, "Ana Costa", {
        fit: { rentsBcd: true, bcdSize: "M", fitStatedAt: new Date() } as never,
      }),
    ],
    plannedDives: 2,
  });
  return prep;
}

export function renderPrep(
  prep: TripPrep,
  {
    grouping = "item",
    notice,
    noticeCount,
    sailed = false,
  }: { grouping?: PrepGrouping; notice?: string; noticeCount?: string; sailed?: boolean } = {},
) {
  return render(
    <PrepBody
      prep={prep}
      t={t}
      locale={DEFAULT_DIVER_LOCALE}
      shopSlug="blue-mantis"
      tripId="t1"
      rentalItems={["bcd", "wetsuit", "boots", "weights", "regulator", "fins"]}
      notice={notice}
      noticeCount={noticeCount}
      grouping={grouping}
      groupPath="/shop/blue-mantis/trips/t1"
      cancelled={false}
      sailed={sailed}
      className={STACK}
    />,
  );
}

/** Every link on the list that opens a diver's record. */
export function diverLinks(root: HTMLElement): HTMLElement[] {
  return within(root)
    .getAllByRole("link")
    .filter((link) => /\/divers\/p\d/.test(link.getAttribute("href") ?? ""));
}

/** The element whose own text is exactly `text`, for finding a panel by its words. */
export function byText(root: HTMLElement, text: string): HTMLElement {
  return within(root).getByText(text, { exact: true });
}

/** A class list as tokens, so `mt-4` never matches inside `-mt-4` or `sm:mt-4`. */
export function tokens(element: Element | null | undefined): string[] {
  return (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * A spacing utility's length in px on Tailwind's 4px scale, read off the
 * element's own tokens: `gap-y-6` is 24, `-my-2.5` is 10, and an element with
 * no such token is 0.
 */
export function spacingPx(element: Element | null | undefined, utility: string): number {
  for (const token of tokens(element)) {
    if (!token.startsWith(`${utility}-`)) continue;
    const step = Number(token.slice(utility.length + 1));
    if (Number.isFinite(step)) return step * 4;
  }
  return 0;
}

/** Where the grouping switch points: the departure page both callers share here. */
export const PREP_GROUP_PATH = "/shop/blue-mantis/trips/t1";

/** The `PrepView` `PrepBody` builds for a section, on a route (no id prefix). */
export function viewOf(
  prep: TripPrep,
  {
    cancelled = false,
    sailed = false,
    home = false,
  }: { cancelled?: boolean; sailed?: boolean; home?: boolean } = {},
): PrepView {
  return {
    prep,
    t,
    locale: DEFAULT_DIVER_LOCALE,
    shopSlug: "blue-mantis",
    tripId: "t1",
    idPrefix: undefined,
    cancelled,
    sailed,
    home,
  };
}
