import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { noticeFromParam } from "@/lib/staff-notices";

/**
 * One entry per notice, carrying its own tone and message key. Previously
 * this was a ternary chain with a hand-maintained parallel list of which
 * codes were errors — adding a danger notice to one and not the other
 * rendered a failure in success green. Tone lives with the key so the two
 * cannot drift.
 */
const NOTICE_KEYS: Record<string, { tone: "success" | "danger"; key: StaffMessageKey }> = {
  captured: { tone: "success", key: "divers.notices.captured" },
  "captured-no-photo": { tone: "success", key: "divers.notices.capturedNoPhoto" },
  verified: { tone: "success", key: "divers.notices.verified" },
  "card-deleted": { tone: "success", key: "divers.notices.cardDeleted" },
  "card-restored": { tone: "success", key: "divers.notices.cardRestored" },
  "card-restore-conflict": { tone: "danger", key: "divers.notices.cardRestoreConflict" },
  "person-saved": { tone: "success", key: "divers.notices.personSaved" },
  "profile-saved": { tone: "success", key: "divers.notices.profileSaved" },
  "fit-flagged": { tone: "success", key: "divers.notices.fitFlagged" },
  "fit-cleared": { tone: "success", key: "divers.notices.fitCleared" },
  image: { tone: "danger", key: "divers.notices.image" },
  duplicate: { tone: "danger", key: "divers.notices.duplicate" },
  refunded: { tone: "success", key: "divers.notices.refunded" },
  booked: { tone: "success", key: "divers.notices.booked" },
  trip_full: { tone: "danger", key: "divers.notices.tripFull" },
  already_booked: { tone: "danger", key: "divers.notices.alreadyBooked" },
  course_unstaffed: { tone: "danger", key: "divers.notices.courseUnstaffed" },
  course_prerequisite: { tone: "danger", key: "divers.notices.coursePrerequisite" },
  course_ratio_full: { tone: "danger", key: "divers.notices.courseRatioFull" },
  course_min_age: { tone: "danger", key: "divers.notices.courseMinAge" },
  trip_unavailable: { tone: "danger", key: "divers.notices.tripUnavailable" },
  "booking-invalid": { tone: "danger", key: "divers.notices.bookingInvalid" },
  "refund-failed": { tone: "danger", key: "divers.notices.refundFailed" },
  "demo-disabled": { tone: "success", key: "divers.notices.demoDisabled" },
  deleted: { tone: "success", key: "divers.notices.deleted" },
  "not-authorized-refund": { tone: "danger", key: "divers.notices.notAuthorizedRefund" },
  "not-authorized-delete": { tone: "danger", key: "divers.notices.notAuthorizedDelete" },
  "not-authorized-erase": { tone: "danger", key: "divers.notices.notAuthorizedErase" },
  "erase-name-mismatch": { tone: "danger", key: "divers.notices.eraseNameMismatch" },
  "erase-refused": { tone: "danger", key: "divers.notices.eraseRefused" },
  "not-authorized-fit": { tone: "danger", key: "divers.notices.notAuthorizedFit" },
  "card-sighting-required": { tone: "danger", key: "divers.notices.cardSightingRequired" },
  invalid: { tone: "danger", key: "divers.notices.invalid" },
};

export function NoticeBanner({ notice, locale }: { notice?: string; locale: string }) {
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  if (!banner) return null;
  const t = staffTranslator(locale);

  return (
    <p
      role="status"
      className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${banner.tone === "danger" ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}
    >
      {t(banner.key)}
    </p>
  );
}
