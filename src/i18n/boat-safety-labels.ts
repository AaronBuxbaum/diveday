import {
  type BoatPaper,
  type BoatSafetyNotice,
  type BoatSafetySection,
  boatSafetyNoticeTone,
  type MustCarryKitKind,
} from "@/lib/boat-safety";
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

const PAPER_KEYS: Record<BoatPaper, { due: StaffMessageKey; expired: StaffMessageKey }> = {
  inspection: {
    due: "boatSafety.paper.inspection.due",
    expired: "boatSafety.paper.inspection.expired",
  },
  registration: {
    due: "boatSafety.paper.registration.due",
    expired: "boatSafety.paper.registration.expired",
  },
  insurance: {
    due: "boatSafety.paper.insurance.due",
    expired: "boatSafety.paper.insurance.expired",
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

/** One notice, as one sentence. */
export function boatSafetyNoticeText(t: StaffTranslator, notice: BoatSafetyNotice): string {
  switch (notice.code) {
    case "over_certificate":
      return t(
        notice.counted ? "boatSafety.overCertificate.aboard" : "boatSafety.overCertificate.booked",
        {
          passengers: notice.passengers,
          limit: notice.limit,
        },
      );
    case "kit_missing":
      return t(MISSING_KEYS[notice.kind]);
    case "paper": {
      const keys = PAPER_KEYS[notice.paper];
      return t(notice.expired ? keys.expired : keys.due, { days: notice.days });
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
  safety: { boatName: string; notices: readonly BoatSafetyNotice[] } | null,
): BoatSafetySection | null {
  if (!safety || safety.notices.length === 0) return null;
  return {
    heading: boatSafetyHeadingText(t, safety.boatName),
    lines: safety.notices.map((notice) => ({
      text: boatSafetyNoticeText(t, notice),
      tone: boatSafetyNoticeTone(notice),
    })),
  };
}
