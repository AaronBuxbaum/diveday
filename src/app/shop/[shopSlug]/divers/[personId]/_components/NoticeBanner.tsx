import Link from "next/link";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { noticeFromParam } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";

/**
 * One entry per notice, carrying its own tone and message key. Previously
 * this was a ternary chain with a hand-maintained parallel list of which
 * codes were errors — adding a danger notice to one and not the other
 * rendered a failure in success green. Tone lives with the key so the two
 * cannot drift.
 */
type NoticeTone = "success" | "danger" | "warning";

/**
 * `warning` is the third tone this banner needs: a seating that worked but left
 * the staffer holding something (`booked-waiver-undelivered`) is neither a
 * failure to fix nor a clean success to walk away from. `-strong` because the
 * text sits on its own `/10` fill at small size (see --warning-strong in
 * globals.css).
 */
const TONE_CLASS: Record<NoticeTone, string> = {
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning-strong",
};

/**
 * A notice that names something the staffer can go and fix carries the link to
 * it, rather than describing a place and leaving them to find it. Only the
 * refusals that have somewhere to send someone get one.
 */
type NoticeLink = { key: StaffMessageKey; href: (shopSlug: string) => string };

const NOTICE_KEYS: Record<string, { tone: NoticeTone; key: StaffMessageKey; link?: NoticeLink }> = {
  captured: { tone: "success", key: "divers.notices.captured" },
  verified: { tone: "success", key: "divers.notices.verified" },
  "card-deleted": { tone: "success", key: "divers.notices.cardDeleted" },
  "card-restored": { tone: "success", key: "divers.notices.cardRestored" },
  "card-restore-conflict": { tone: "danger", key: "divers.notices.cardRestoreConflict" },
  "person-saved": { tone: "success", key: "divers.notices.personSaved" },
  "profile-saved": { tone: "success", key: "divers.notices.profileSaved" },
  "fit-flagged": { tone: "success", key: "divers.notices.fitFlagged" },
  "fit-cleared": { tone: "success", key: "divers.notices.fitCleared" },
  duplicate: { tone: "danger", key: "divers.notices.duplicate" },
  refunded: { tone: "success", key: "divers.notices.refunded" },
  booked: { tone: "success", key: "divers.notices.booked" },
  "booked-waiver-undelivered": {
    tone: "warning",
    key: "divers.notices.bookedWaiverUndelivered",
  },
  trip_full: { tone: "danger", key: "divers.notices.tripFull" },
  already_booked: { tone: "danger", key: "divers.notices.alreadyBooked" },
  course_unstaffed: { tone: "danger", key: "divers.notices.courseUnstaffed" },
  course_prerequisite: { tone: "danger", key: "divers.notices.coursePrerequisite" },
  course_ratio_full: { tone: "danger", key: "divers.notices.courseRatioFull" },
  course_min_age: { tone: "danger", key: "divers.notices.courseMinAge" },
  trip_prerequisite: { tone: "danger", key: "divers.notices.tripPrerequisite" },
  trip_unavailable: { tone: "danger", key: "divers.notices.tripUnavailable" },
  "booking-invalid": { tone: "danger", key: "divers.notices.bookingInvalid" },
  "refund-failed": { tone: "danger", key: "divers.notices.refundFailed" },
  "demo-disabled": { tone: "success", key: "divers.notices.demoDisabled" },
  deleted: { tone: "success", key: "divers.notices.deleted" },
  restored: { tone: "success", key: "divers.notices.restored" },
  // The restore ran into the live record that now holds this diver's email
  // (`restoreDiver`, CR-008), or an erased record that has no way back. Either
  // way there is a thing to do about it, and the copy names it.
  "restore-refused": { tone: "danger", key: "divers.notices.restoreRefused" },
  // A removed record is reachable but not editable: `updateDiver` refuses it
  // outright, and without this the refusal read as an email conflict.
  "removed-read-only": { tone: "danger", key: "divers.notices.removedReadOnly" },
  "not-authorized-refund": { tone: "danger", key: "divers.notices.notAuthorizedRefund" },
  "not-authorized-delete": { tone: "danger", key: "divers.notices.notAuthorizedDelete" },
  "not-authorized-erase": { tone: "danger", key: "divers.notices.notAuthorizedErase" },
  "erase-name-mismatch": { tone: "danger", key: "divers.notices.eraseNameMismatch" },
  "erase-refused": { tone: "danger", key: "divers.notices.eraseRefused" },
  "not-authorized-fit": { tone: "danger", key: "divers.notices.notAuthorizedFit" },
  "card-sighting-required": { tone: "danger", key: "divers.notices.cardSightingRequired" },
  invalid: { tone: "danger", key: "divers.notices.invalid" },
  // `orders/new` refuses to open at all until the shop can accept payments and
  // bounces back here. Without an entry this code rendered nothing, so the
  // "New payment" button read as simply broken — the click went nowhere and
  // said nothing. The link is the whole point: the fix is one screen away.
  "payment-not-connected": {
    tone: "warning",
    key: "divers.notices.paymentNotConnected",
    link: {
      key: "shared.payments.connect",
      href: (shopSlug) => `/shop/${shopSlug}/settings#money`,
    },
  },
};

export function NoticeBanner({
  notice,
  gate,
  locale,
  shopSlug,
  personId,
}: {
  notice?: string;
  /**
   * The signed `TripAdmissionRefusal` behind `trip_prerequisite` — the trip's
   * unmet cert requirement and the diver's highest card
   * (src/lib/trip-admission-gate.ts). This is the surface the old copy sent
   * staff to ("Add the missing card above"), so it is the one that most needed
   * to stop saying that on a refusal no card can fix — and, for the same
   * reason, the one where a *forged* specific refusal would do the most damage.
   * Absent or unverifiable falls back to the generic sentence. `string[]`
   * because a repeated `?gate=` really delivers one.
   */
  gate?: string | string[];
  locale: string;
  shopSlug: string;
  /**
   * This record's own person id, from the path. The gate signature is bound to
   * it — this landing URL carries no departure at all, so the diver is the one
   * identity the reader can check without trusting the query.
   */
  personId: string;
}) {
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  if (!banner) return null;
  const t = staffTranslator(locale);
  const refusal =
    notice === "trip_prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "diver", id: personId })
      : null;

  return (
    <p
      role="status"
      className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${TONE_CLASS[banner.tone]}`}
    >
      {refusal ? tripAdmissionRefusalText(t, refusal, locale) : t(banner.key)}
      {banner.link ? (
        <>
          {" "}
          <Link href={banner.link.href(shopSlug)} className="underline underline-offset-2">
            {t(banner.link.key)}
          </Link>
        </>
      ) : null}
    </p>
  );
}
