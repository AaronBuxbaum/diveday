import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { type DiverNotice, diverNoticeForm, NOTICE_KEYS, NOTICE_LINKS } from "@/lib/diver-notices";
import { noticeFromParam } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";

/**
 * Resolves a notice code to its message and owning form. Unclaimed notices
 * remain available to the page-level banner.
 */
export function resolveDiverNotice({
  notice,
  form,
  gate,
  card,
  personId,
  locale,
  canRaiseInvoice = false,
  conflictDeparture,
  personName,
}: {
  notice?: string;
  /**
   * Form override for codes emitted by more than one form.
   */
  form?: string;
  /**
   * Signed refusal detail for `trip-prerequisite`. It is verified against this
   * record's person id before use; absent or invalid signatures use generic
   * copy. Repeated query parameters arrive as an array.
   */
  gate?: string | string[];
  /** The card the refusal is about, for a code that names a box (`?card=`). */
  card?: string;
  /**
   * Person id from the path. The signed gate is bound to this id.
   */
  personId: string;
  /** The stored name from this record, never a query parameter. */
  personName?: string;
  locale: string;
  /**
   * Whether this reader can raise an invoice. Defaults to false.
   */
  canRaiseInvoice?: boolean;
  /**
   * Formatted departure detail for `merge-booking-conflict`, resolved from the
   * shop-scoped trip row rather than URL text.
   */
  conflictDeparture?: string;
}): DiverNotice | undefined {
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  if (!banner) return undefined;
  const t = staffTranslator(locale);
  const refusal =
    notice === "trip-prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "diver", id: personId })
      : null;
  return {
    form: diverNoticeForm(form, banner.form),
    tone: banner.tone,
    text: banner.silent
      ? ""
      : notice === "diver-clear"
        ? t("divers.notices.cleared", {
            name: personName?.trim() || t("shared.waiverSend.unnamedDiver"),
          })
        : refusal
          ? tripAdmissionRefusalText(t, refusal, locale)
          : notice === "booked" && !canRaiseInvoice
            ? t("divers.notices.bookedNoInvoice")
            : notice === "booked-confirmed" && !canRaiseInvoice
              ? t("divers.notices.bookedConfirmedNoInvoice")
              : notice === "merge-booking-conflict" && conflictDeparture
                ? t("divers.notices.mergeBookingConflictOn", { departure: conflictDeparture })
                : t(banner.key as StaffMessageKey, banner.values),
    code: notice,
    link: notice === undefined ? undefined : NOTICE_LINKS[notice],
    field: banner.field,
    // Only ever paired with a `field`: an id on a notice that names no box has
    // nothing to compare against and would read as one that does.
    cardId: banner.field ? card : undefined,
    silent: banner.silent,
  };
}
