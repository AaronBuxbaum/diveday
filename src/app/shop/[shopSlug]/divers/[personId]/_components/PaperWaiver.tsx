import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { markWaiverInPersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

/**
 * "This diver signed on paper", on the diver's own record.
 *
 * The roster and the check-in queue carry the same control, and both are
 * reached from a departure. The conversation that ends in a paper release is
 * often about the person instead — they phone ahead, or hand the form over
 * months before they book anything — so this one is filed against the diver
 * and no seat (ADR 20260811-person-scoped-paper-waivers).
 *
 * Directly under the stat row, because the Waiver card is what sends anyone
 * looking. It renders only for the two states a signature answers: never
 * signed, and lapsed. A held medical review is waiting on a doctor, and the
 * surfaces built to review it own that decision.
 */
export function PaperWaiver({
  diver,
  shopSlug,
  personId,
  locale,
  status,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
  /** This form's own outcome, rendered under it rather than page-top. */
  status?: DiverNotice;
}) {
  const outstanding = diver.waiver.state === "none" || diver.waiver.state === "expired";
  if (!outstanding) return null;
  const t = staffTranslator(locale);
  const bookingIds = diver.bookings
    .filter(
      ({ booking, trip }) =>
        trip.status === "scheduled" && booking.status !== "cancelled" && trip.startsAt >= nowDate(),
    )
    .map(({ booking }) => booking.id);
  const firstBooking = diver.bookings.find(({ booking }) => bookingIds.includes(booking.id));
  return (
    <div className="mt-3">
      {bookingIds.length > 0 ? (
        <WaiverSendControl
          shopSlug={shopSlug}
          surface="roster"
          tripId={firstBooking?.trip.id}
          bookingIds={bookingIds}
          label={t("divers.stats.waiverSend")}
          exposeLink
          copy={waiverSendCopy(t)}
        />
      ) : null}
      <PaperWaiverControl
        action={markWaiverInPersonAction.bind(null, shopSlug, personId)}
        t={t}
        className="mt-3"
      />
      <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-2" />
    </div>
  );
}
