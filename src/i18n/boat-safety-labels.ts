import {
  type BoatPaper,
  type BoatSafetyNotice,
  type BoatSafetySection,
  boatSafetyNoticeTone,
  type MustCarryKitKind,
} from "@/lib/boat-safety";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { GearServiceKind } from "@/lib/gear";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The pre-departure check's sentences about a boat's papers and safety kit
 * (`src/lib/boat-safety.ts` returns the codes). One sentence per notice,
 * composed whole so word order stays the locale's: "AED: pads expire in 12
 * days", "Flares: expired 3 days ago", "Insurance expires in 21 days".
 *
 * Total over every clock that can carry a date, so a new clock is a compile
 * error here rather than a raw code on a manifest. `note` never reaches a
 * notice (it has no clock) and borrows the printed-date wording if it ever did.
 *
 * A lapsed paper names the day it ran out, "Hull insurance ended Oct 8, 2026",
 * rather than a count of days since: the date is what the owner checks the
 * policy against (H-20261015-lapsed-boat-papers-loud). A calendar date, so it has no zone to name.
 */
const KIT_KEYS: Record<GearServiceKind, { due: StaffMessageKey; expired: StaffMessageKey }> = {
  aed_pads: { due: "boatSafety.kit.aedPads.due", expired: "boatSafety.kit.aedPads.expired" },
  aed_battery: {
    due: "boatSafety.kit.aedBattery.due",
    expired: "boatSafety.kit.aedBattery.expired",
  },
  expiry: { due: "boatSafety.kit.expiry.due", expired: "boatSafety.kit.expiry.expired" },
  note: { due: "boatSafety.kit.expiry.due", expired: "boatSafety.kit.expiry.expired" },
  service: { due: "boatSafety.kit.service.due", expired: "boatSafety.kit.service.expired" },
  hydro_test: { due: "boatSafety.kit.hydroTest.due", expired: "boatSafety.kit.hydroTest.expired" },
  visual_inspection: {
    due: "boatSafety.kit.visualInspection.due",
    expired: "boatSafety.kit.visualInspection.expired",
  },
  o2_clean: { due: "boatSafety.kit.o2Clean.due", expired: "boatSafety.kit.o2Clean.expired" },
};

const PAPER_KEYS: Record<
  BoatPaper,
  { due: StaffMessageKey; expired: StaffMessageKey; beforeDeparture: StaffMessageKey }
> = {
  coi: {
    due: "boatSafety.paper.coi.due",
    expired: "boatSafety.paper.coi.expired",
    beforeDeparture: "boatSafety.paper.coi.beforeDeparture",
  },
  inspection: {
    due: "boatSafety.paper.inspection.due",
    expired: "boatSafety.paper.inspection.expired",
    beforeDeparture: "boatSafety.paper.inspection.beforeDeparture",
  },
  registration: {
    due: "boatSafety.paper.registration.due",
    expired: "boatSafety.paper.registration.expired",
    beforeDeparture: "boatSafety.paper.registration.beforeDeparture",
  },
  insurance: {
    due: "boatSafety.paper.insurance.due",
    expired: "boatSafety.paper.insurance.expired",
    beforeDeparture: "boatSafety.paper.insurance.beforeDeparture",
  },
};

const MISSING_KEYS: Record<MustCarryKitKind, StaffMessageKey> = {
  o2_kit: "boatSafety.missing.o2Kit",
  aed: "boatSafety.missing.aed",
};

/** The section's heading: the hull, and what the lines are about. */
export function boatSafetyHeadingText(t: StaffTranslator, boatName: string): string {
  return t("boatSafety.heading", { boatName });
}

/** One notice, as one sentence. `locale` dates a lapsed paper. */
export function boatSafetyNoticeText(
  t: StaffTranslator,
  locale: string,
  notice: BoatSafetyNotice,
): string {
  switch (notice.code) {
    case "over_certificate":
      return t(
        notice.counted ? "boatSafety.overCertificate.aboard" : "boatSafety.overCertificate.booked",
        {
          passengers: notice.passengers,
          limit: notice.limit,
        },
      );
    case "over_total_persons":
      return t(
        notice.counted
          ? "boatSafety.overTotalPersons.aboard"
          : "boatSafety.overTotalPersons.booked",
        { persons: notice.persons, limit: notice.limit },
      );
    case "kit_missing":
      return t(MISSING_KEYS[notice.kind]);
    case "paper": {
      const keys = PAPER_KEYS[notice.paper];
      if (!notice.expired) return t(keys.due, { days: notice.days });
      const date = formatCalendarDate(notice.dueOn, locale);
      return t(notice.beforeDeparture ? keys.beforeDeparture : keys.expired, { date });
    }
    case "kit_clock": {
      const keys = KIT_KEYS[notice.clock];
      return t(notice.expired ? keys.expired : keys.due, {
        label: notice.label,
        days: notice.days,
      });
    }
    case "kit_off_service":
      return t("boatSafety.kit.offService", { label: notice.label });
  }
}

/**
 * The whole section, worded: the heading and one toned line per notice, or
 * null when the boat has nothing to say. The live manifest renders it and the
 * offline copy carries it as is.
 */
export function boatSafetySection(
  t: StaffTranslator,
  locale: string,
  safety: { boatName: string; notices: readonly BoatSafetyNotice[] } | null,
): BoatSafetySection | null {
  if (!safety || safety.notices.length === 0) return null;
  return {
    heading: boatSafetyHeadingText(t, safety.boatName),
    lines: safety.notices.map((notice) => ({
      text: boatSafetyNoticeText(t, locale, notice),
      tone: boatSafetyNoticeTone(notice),
    })),
  };
}
