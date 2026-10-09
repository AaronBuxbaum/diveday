import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";

/**
 * What the board says after a builder action, keyed by the `outcome.reason`
 * code the mutation returns (see `moveTrip`/`duplicateTrip`/`deleteTrip` in
 * src/db/trips.ts). Every outcome gets a sentence — including the refusals,
 * which are the interesting ones: a departure that won't move or won't delete
 * is protecting a roster or a head count, and the staff member needs to know
 * which, not just that nothing happened. The message itself is a lookup into
 * the staff bundle, never English baked into this map (docs `i18n-copy` skill).
 */
export const BUILDER_NOTICE_KEYS: Record<
  string,
  { tone: "success" | "danger" | "warning"; key: StaffMessageKey }
> = {
  added: { tone: "success", key: "schedule.notices.added" },
  moved: { tone: "success", key: "schedule.notices.moved" },
  copied: { tone: "success", key: "schedule.notices.copied" },
  removed: { tone: "success", key: "schedule.notices.removed" },
  invalid: { tone: "danger", key: "schedule.notices.invalid" },
  "end-before-start": { tone: "danger", key: "schedule.notices.endBeforeStart" },
  "not-authorized": { tone: "danger", key: "schedule.notices.notAuthorized" },
  "not-found": { tone: "danger", key: "schedule.notices.notFound" },
  "not-scheduled": { tone: "warning", key: "schedule.notices.notScheduled" },
  "already-sailed": { tone: "warning", key: "schedule.notices.alreadySailed" },
  "has-roster": { tone: "warning", key: "schedule.notices.hasRoster" },
  "capacity-above-boat": { tone: "danger", key: "schedule.notices.capacityAboveBoat" },
  // H-107: the certificate's limit is a ceiling too.
  "capacity-above-certificate": {
    tone: "danger",
    key: "schedule.notices.capacityAboveCertificate",
  },
};

/**
 * The sentence for a builder notice. The certificate refusal names the limit
 * when the redirect carried it (`?count=`, H-107), so the staffer knows the
 * number to type; a URL without one, or with something else there, gets the
 * plain sentence.
 */
export function builderNoticeMessage(
  st: StaffTranslator,
  key: StaffMessageKey,
  count: string | undefined,
): string {
  if (key === "schedule.notices.capacityAboveCertificate" && count && /^\d{1,4}$/.test(count)) {
    return st("schedule.notices.capacityAboveCertificateCount", {
      count: Number.parseInt(count, 10),
    });
  }
  return st(key);
}
