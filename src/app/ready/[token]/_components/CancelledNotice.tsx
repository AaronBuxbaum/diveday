import Link from "next/link";
import { EntryDone } from "@/components/account/EntryShell";
import { buttonClass } from "@/components/ui/button";
import type { AppDb } from "@/db/client";
import { getBookingPayment } from "@/db/payments";
import type { ReadyPageData } from "@/db/ready";
import { partySeatsKeptAfterLeadCancel } from "@/db/seat-claims";
import { nextPublicTripInSeries } from "@/db/series-next";
import type { DiverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { verifiedCancelNotice } from "./cancel-notices";
import { ForgetReadyCopy } from "./ForgetReadyCopy";

/**
 * The "This booking was cancelled" notice, with refund copy derived from the
 * booking's current payment status, and a way onward (third UX review, item
 * 16): the page was a heading and a sentence with nothing to tap, where the
 * cancellation email carries the schedule. The schedule always; for a
 * repeating departure, the next date of the same run by name first.
 *
 * `EntryDone` is the app's one warm terminal pattern (docs/design/principles.md
 * #4), with the `cancelled` calendar rather than the expired clock, because the
 * link is fine and telling that diver to ask for a fresh one would send them
 * the wrong way.
 */
export async function cancelledNotice(
  db: AppDb,
  input: {
    paymentStatus: string | null | undefined;
    trip: { id: string; title: string };
    shop: { id: string; slug: string; name: string; timezone: string };
    locale: string;
    t: DiverTranslator;
    /** A lead's party seats still booked, by name (batch 6 item 10); read from the seats. */
    partyKept?: string[];
  },
) {
  const { trip, shop, locale, t } = input;
  const refundKey = verifiedCancelNotice(input.paymentStatus);
  const kept = input.partyKept ?? [];
  const money = refundKey
    ? t(refundKey)
    : t("ready.cancelledSeatReleased", { trip: trip.title, shop: shop.name });
  // The lead learns which of the seats they booked stayed: their own divers'.
  const keptLine =
    kept.length > 0
      ? t("ready.cancelledPartyKept", {
          count: kept.length,
          names: cachedListFormat(locale, { type: "conjunction" }).format(kept),
          trip: trip.title,
        })
      : null;
  const next = await nextPublicTripInSeries(db, {
    shopId: shop.id,
    tripId: trip.id,
    now: nowDate(),
  });
  return (
    <>
      {/* The seat is gone, so is the phone's saved copy of its page (#2979). */}
      <ForgetReadyCopy />
      <EntryDone
        glyph="cancelled"
        title={t("ready.cancelledHeading")}
        text={keptLine ? `${money} ${keptLine}` : money}
        action={
          <span className="flex flex-col items-center gap-2">
            {next ? (
              <Link
                href={`${publicTripPath(shop.slug, next.id)}#book`}
                className={buttonClass({ size: "sm" })}
              >
                {t("ready.cancelledNextInSeries", {
                  trip: next.title,
                  date: formatShortDate(next.startsAt, locale, shop.timezone),
                })}
              </Link>
            ) : null}
            <Link
              href={publicSchedulePath(shop.slug)}
              className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
            >
              {t("ready.cancelledSeeSchedule")}
            </Link>
          </span>
        }
      />
    </>
  );
}

/**
 * The same notice, from the readiness page's own data (the route stays thin).
 * The money sentence is read from the booking's payment row, never the URL.
 */
export async function cancelledNoticeForReady(
  db: AppDb,
  data: ReadyPageData,
  bookingId: string,
  locale: string,
  t: DiverTranslator,
) {
  const [payment, partyKept] = await Promise.all([
    getBookingPayment(db, data.shop.id, bookingId),
    partySeatsKeptAfterLeadCancel(db, { shopId: data.shop.id, leadBookingId: bookingId }),
  ]);
  return cancelledNotice(db, {
    paymentStatus: payment?.status,
    partyKept,
    trip: { id: data.trip.id, title: data.detail.trip.title },
    shop: {
      id: data.shop.id,
      slug: data.shop.slug,
      name: data.detail.shop.name,
      timezone: data.detail.shop.timezone,
    },
    locale,
    t,
  });
}
