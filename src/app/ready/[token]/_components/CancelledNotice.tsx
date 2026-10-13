import Link from "next/link";
import { EntryDone } from "@/components/account/EntryShell";
import { buttonClass } from "@/components/ui/button";
import type { AppDb } from "@/db/client";
import { nextPublicTripInSeries } from "@/db/series-next";
import type { DiverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { verifiedCancelNotice } from "./cancel-notices";

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
  },
) {
  const { trip, shop, locale, t } = input;
  const refundKey = verifiedCancelNotice(input.paymentStatus);
  const next = await nextPublicTripInSeries(db, {
    shopId: shop.id,
    tripId: trip.id,
    now: nowDate(),
  });
  return (
    <EntryDone
      glyph="cancelled"
      title={t("ready.cancelledHeading")}
      text={
        refundKey
          ? t(refundKey)
          : t("ready.cancelledSeatReleased", { trip: trip.title, shop: shop.name })
      }
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
  );
}
