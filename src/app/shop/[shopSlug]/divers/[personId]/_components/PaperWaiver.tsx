import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { markWaiverInPersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import { type DiverProfile, paperWaiverBookingId } from "./shared";

/**
 * "This diver signed on paper", on the diver's own record.
 *
 * The roster and the check-in queue already carry this control, and both are
 * reached from a *departure*. The conversation that ends in a paper release is
 * often about the person instead — they phone ahead, or hand the form over at
 * the counter days before their boat — and this record is where a staffer
 * already is when it happens. Without it the only way out of here was to find
 * one of the diver's trips and go to it.
 *
 * Directly under the stat row, because the Waiver card is what sends anyone
 * looking: that card is the page saying "not signed", and this is the one
 * thing a staffer can do about it from here. It renders at all only when there
 * is something to do — no current signature, and a still-scheduled departure to
 * file the record against.
 */
export function PaperWaiver({
  diver,
  shopSlug,
  personId,
  locale,
  status,
  now = nowDate(),
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
  /** This form's own outcome, rendered under it rather than page-top. */
  status?: DiverNotice;
  now?: Date;
}) {
  const t = staffTranslator(locale);
  const bookingId = paperWaiverBookingId(diver, now);
  // A held medical review is deliberately not offered a paper override here:
  // that state is waiting on a doctor's clearance, and the surfaces built to
  // review it own the decision (src/lib/waivers.ts). This control is for the
  // two states a signature actually answers — never signed, and lapsed.
  const outstanding = diver.waiver.state === "none" || diver.waiver.state === "expired";
  if (!bookingId || !outstanding) return null;
  return (
    <div className="mt-3">
      <PaperWaiverControl
        action={markWaiverInPersonAction.bind(null, shopSlug, personId)}
        bookingId={bookingId}
        t={t}
        className=""
      />
      <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-2" />
    </div>
  );
}
