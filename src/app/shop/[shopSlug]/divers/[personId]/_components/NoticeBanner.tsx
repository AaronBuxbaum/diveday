import Link from "next/link";
import { ShopNotice } from "@/components/ShopPageHeader";
import { FormStatus } from "@/components/ui/form";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { type FormNotice, noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";

/**
 * A notice that names something the staffer can go and fix carries the link to
 * it, rather than describing a place and leaving them to find it. Only the
 * refusals that have somewhere to send someone get one.
 */
type NoticeLink = { key: StaffMessageKey; href: (shopSlug: string) => string };

/**
 * One entry per notice code, carrying its tone, its message key, and — the
 * field that changed here — **the form it belongs to**.
 *
 * This page is one ~6,400px scroll of eight independent sections: the details
 * editor, level cards, specialty cards, rental fit, payments, book-an-activity,
 * remove, erase. Every one of their outcomes used to resolve into a single
 * banner under the `<h1>`, so saving a rental fit two screens down answered you
 * somewhere you were not looking — the same complaint the trip page's
 * `resolveTripNotice` was built to fix, which this mirrors.
 *
 * `form` is that fix: the page resolves its `?notice=` once and hands each
 * section its own with `noticeForForm`, and the section renders it in its own
 * action row (`FormStatus`). `"page"` is left for what is genuinely about the
 * page rather than one form on it.
 *
 * `field` names the control a refusal belongs *on* rather than beside, for the
 * one case the server can point at exactly: an email another active diver
 * already holds.
 */
const NOTICE_KEYS: Record<
  string,
  { form: string; tone: "success" | "danger" | "warning"; key: StaffMessageKey; field?: string }
> = {
  // Cards — the two card sections emit the same codes, so their actions stamp
  // an explicit `?form=`; these defaults are what an old link still resolves to.
  captured: { form: "cards", tone: "success", key: "divers.notices.captured" },
  verified: { form: "cards", tone: "success", key: "divers.notices.verified" },
  "card-restored": { form: "cards", tone: "success", key: "divers.notices.cardRestored" },
  "card-restore-conflict": {
    form: "cards",
    tone: "danger",
    key: "divers.notices.cardRestoreConflict",
  },
  "card-sighting-required": {
    form: "specialty-cards",
    tone: "danger",
    key: "divers.notices.cardSightingRequired",
  },
  // The card-removal toast is handled by the page itself (`UndoToast`); this
  // entry is the fallback for a `?notice=card-deleted` with no id to undo.
  "card-deleted": { form: "cards", tone: "success", key: "divers.notices.cardDeleted" },

  // Details editor.
  "person-saved": { form: "details", tone: "success", key: "divers.notices.personSaved" },
  duplicate: {
    form: "details",
    tone: "danger",
    key: "divers.notices.duplicate",
    // The refusal is about one box, so it renders on that box.
    field: "diver-email",
  },
  "removed-read-only": {
    form: "details",
    tone: "danger",
    key: "divers.notices.removedReadOnly",
  },

  // The release, recorded from this record ("signed on paper").
  "waiver-paper-recorded": {
    form: "waiver",
    tone: "success",
    key: "divers.notices.waiverPaperRecorded",
  },
  "waiver-medical-attestation": {
    form: "waiver",
    tone: "warning",
    key: "divers.notices.waiverMedicalAttestation",
  },
  "waiver-error": { form: "waiver", tone: "danger", key: "divers.notices.waiverError" },

  // Rental fit.
  "profile-saved": { form: "fit", tone: "success", key: "divers.notices.profileSaved" },
  "fit-flagged": { form: "fit", tone: "success", key: "divers.notices.fitFlagged" },
  "fit-cleared": { form: "fit", tone: "success", key: "divers.notices.fitCleared" },
  "not-authorized-fit": { form: "fit", tone: "danger", key: "divers.notices.notAuthorizedFit" },

  // Payments.
  refunded: { form: "payments", tone: "success", key: "divers.notices.refunded" },
  "refund-failed": { form: "payments", tone: "danger", key: "divers.notices.refundFailed" },
  // A second tap while the first refund is still at Stripe. Refused locally
  // (PAY-L3) — "wait, don't press again", not "it failed".
  "refund-in-progress": {
    form: "payments",
    tone: "warning",
    key: "divers.notices.refundInProgress",
  },
  "demo-disabled": { form: "payments", tone: "warning", key: "divers.notices.demoDisabled" },
  "not-authorized-refund": {
    form: "payments",
    tone: "danger",
    key: "divers.notices.notAuthorizedRefund",
  },
  // `orders/new` refuses to open at all until the shop can accept payments and
  // bounces back here. Without an entry this code rendered nothing, so the
  // "New payment" button read as simply broken — the click went nowhere and
  // said nothing. The link is the whole point: the fix is one screen away.
  "payment-not-connected": {
    form: "payments",
    tone: "warning",
    key: "divers.notices.paymentNotConnected",
  },

  // Book an activity. Every code below is emitted only by the seating path, so
  // none of them needs an explicit `?form=` to find its way home.
  booked: { form: "book-activity", tone: "success", key: "divers.notices.booked" },
  "booked-waiver-undelivered": {
    form: "book-activity",
    tone: "warning",
    key: "divers.notices.bookedWaiverUndelivered",
  },
  trip_full: { form: "book-activity", tone: "danger", key: "divers.notices.tripFull" },
  already_booked: { form: "book-activity", tone: "danger", key: "divers.notices.alreadyBooked" },
  course_unstaffed: {
    form: "book-activity",
    tone: "danger",
    key: "divers.notices.courseUnstaffed",
  },
  course_prerequisite: {
    form: "book-activity",
    tone: "danger",
    key: "divers.notices.coursePrerequisite",
  },
  course_ratio_full: {
    form: "book-activity",
    tone: "danger",
    key: "divers.notices.courseRatioFull",
  },
  course_min_age: { form: "book-activity", tone: "danger", key: "divers.notices.courseMinAge" },
  trip_prerequisite: {
    form: "book-activity",
    tone: "danger",
    key: "divers.notices.tripPrerequisite",
  },
  trip_unavailable: {
    form: "book-activity",
    tone: "danger",
    key: "divers.notices.tripUnavailable",
  },
  "booking-invalid": {
    form: "book-activity",
    tone: "danger",
    key: "divers.notices.bookingInvalid",
  },

  // Removal, restore, erasure — each beside its own control.
  deleted: { form: "remove", tone: "success", key: "divers.notices.deleted" },
  "not-authorized-delete": {
    form: "remove",
    tone: "danger",
    key: "divers.notices.notAuthorizedDelete",
  },
  // Not `"restore"`, even though a restore is what happened: the restore card
  // renders only while the diver is removed, so a *successful* restore unmounts
  // the very thing the message would have sat in and the confirmation can never
  // be seen. An outcome has to render somewhere that survives the state change
  // it is reporting.
  restored: { form: "page", tone: "success", key: "divers.notices.restored" },
  // The refusal is the opposite case and does belong on the card: the restore
  // failed, so the diver is still removed and the card is still on screen. It
  // ran into the live record that now holds this diver's email (`restoreDiver`,
  // CR-008), or an erased record that has no way back. Either way there is a
  // thing to do about it, and the copy names it.
  "restore-refused": { form: "restore", tone: "danger", key: "divers.notices.restoreRefused" },
  "not-authorized-erase": {
    form: "erase",
    tone: "danger",
    key: "divers.notices.notAuthorizedErase",
  },
  "erase-name-mismatch": {
    form: "erase",
    tone: "danger",
    key: "divers.notices.eraseNameMismatch",
    field: "erase-confirm-name",
  },
  "erase-refused": { form: "erase", tone: "danger", key: "divers.notices.eraseRefused" },

  // Emitted by half a dozen actions, so it has no single home of its own; each
  // one stamps a `?form=` and this default is only reached without one.
  invalid: { form: "page", tone: "danger", key: "divers.notices.invalid" },
};

/**
 * Every form name `NOTICE_KEYS` (or an action's `?form=`) may point at. The
 * `?form=` param is attacker-supplied like any other, so an unknown name has to
 * degrade to the code's own default home rather than being swallowed into a
 * section nothing renders — which would silently lose the notice entirely.
 */
const DIVER_FORMS = new Set([
  "page",
  "details",
  "cards",
  "specialty-cards",
  "waiver",
  "fit",
  "payments",
  "book-activity",
  "remove",
  "restore",
  "erase",
]);

function diverNoticeForm(param: string | undefined, fallback: string): string {
  return param !== undefined && DIVER_FORMS.has(param) ? param : fallback;
}

/**
 * A resolved diver-record notice: the shared `{form, tone, text}` plus the two
 * things this page's notices carry that the shared shape does not — a link to
 * the screen that fixes it, and the id of the control it belongs on.
 */
export type DiverNotice = FormNotice & { link?: NoticeLink; field?: string };

/** Only `payment-not-connected` has somewhere to send someone. */
const NOTICE_LINKS: Record<string, NoticeLink> = {
  "payment-not-connected": {
    key: "shared.payments.connect",
    href: (shopSlug) => `/shop/${shopSlug}/settings#money`,
  },
};

/**
 * Resolves the page's `?notice=` to words and to the form those words belong
 * beside. The page calls this once and hands the result to the section it names
 * (`noticeForForm`); whatever is left over — a genuinely page-level refusal, or
 * a section this staffer's role means the page never rendered — falls through
 * to `NoticeBanner`.
 */
export function resolveDiverNotice({
  notice,
  form,
  gate,
  personId,
  locale,
}: {
  notice?: string;
  /**
   * Which form on the page this notice answers, when the code alone cannot say
   * — `?notice=captured` is emitted by the level-card form and the specialty
   * form alike, and `?notice=invalid` by half a dozen actions.
   */
  form?: string;
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
  /**
   * This record's own person id, from the path. The gate signature is bound to
   * it — this landing URL carries no departure at all, so the diver is the one
   * identity the reader can check without trusting the query.
   */
  personId: string;
  locale: string;
}): DiverNotice | undefined {
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  if (!banner) return undefined;
  const t = staffTranslator(locale);
  const refusal =
    notice === "trip_prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "diver", id: personId })
      : null;
  return {
    form: diverNoticeForm(form, banner.form),
    tone: banner.tone,
    text: refusal ? tripAdmissionRefusalText(t, refusal, locale) : t(banner.key),
    link: notice === undefined ? undefined : NOTICE_LINKS[notice],
    field: banner.field,
  };
}

/**
 * One section's own outcome, in that section's action row.
 *
 * A thin wrapper over the shared `FormStatus` so every section on this page
 * spells the same one-liner, and so the one notice that carries a link
 * (`payment-not-connected`) keeps it wherever it lands. Renders nothing at
 * rest, so a form's action row keeps its exact resting layout.
 */
export function DiverFormStatus({
  status,
  shopSlug,
  locale,
  className = "",
}: {
  status?: DiverNotice;
  shopSlug: string;
  locale: string;
  className?: string;
}) {
  if (!status) return null;
  const t = staffTranslator(locale);
  return (
    <FormStatus tone={status.tone} className={className}>
      {status.text}
      {status.link ? (
        <>
          {" "}
          <Link href={status.link.href(shopSlug)} className="underline underline-offset-2">
            {t(status.link.key)}
          </Link>
        </>
      ) : null}
    </FormStatus>
  );
}

/**
 * The page-level banner — now only for what has no form to sit beside: a
 * refusal that bounced the staffer here from somewhere else, the generic
 * `invalid` fallback with no `?form=` on it, and any notice whose section this
 * staffer's role means the page never rendered (a refund refusal for someone
 * who cannot see the refund control at all).
 */
export function NoticeBanner({
  notice,
  shopSlug,
  locale,
}: {
  notice?: DiverNotice;
  shopSlug: string;
  locale: string;
}) {
  if (!notice) return null;
  const t = staffTranslator(locale);
  return (
    <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)} className="mt-6">
      {notice.text}
      {notice.link ? (
        <>
          {" "}
          <Link href={notice.link.href(shopSlug)} className="underline underline-offset-2">
            {t(notice.link.key)}
          </Link>
        </>
      ) : null}
    </ShopNotice>
  );
}
