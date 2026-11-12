import Link from "next/link";
import { PersonClashNotice } from "@/app/shop/[shopSlug]/_components/PersonClashNotice";
import { ShopNotice } from "@/components/ui/outcome";
import type { AppDb } from "@/db/client";
import { isLockWaitRefusal } from "@/db/lock-bounds";
import { getTripPersonClashes } from "@/features/trip-page";
import { staffTranslator } from "@/i18n/staff-messages";
import type { FormNotice } from "@/lib/staff-notices";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { TripNoticeBanner } from "./TripNoticeBanner";

export async function TripPageResultNotices({
  rootPageNotice,
  rest,
  db,
  shop,
  trip,
  shopSlug,
  locale,
}: {
  rootPageNotice?: FormNotice;
  rest: { clashResult?: string; clashes?: string };
  db: AppDb;
  shop: { id: string; timezone: string };
  trip: { id: string; startsAt: Date };
  shopSlug: string;
  locale: string;
}) {
  const live =
    rest.clashes === "1"
      ? await getTripPersonClashes(db, shop.id, trip.id).catch((error: unknown) => {
          if (isLockWaitRefusal(error)) return "busy" as const;
          throw error;
        })
      : null;
  const t = staffTranslator(locale);
  return (
    <>
      <TripNoticeBanner notice={rootPageNotice} locale={locale} />
      <PersonClashNotice
        token={rest.clashResult}
        shopId={shop.id}
        tripId={trip.id}
        shopSlug={shopSlug}
        day={toDateInputValue(utcToWallTime(trip.startsAt, shop.timezone))}
        locale={locale}
      />
      {live === "busy" ? (
        <ShopNotice tone="warning" persistent className="mb-6">
          <Link href={`/shop/${shopSlug}/trips/${trip.id}?view=details&clashes=1`}>
            {t("schedule.dayBoard.reviewBusy")}
          </Link>
        </ShopNotice>
      ) : live ? (
        <ShopNotice tone={live.length ? "warning" : "success"} persistent className="mb-6">
          {live.length ? (
            <p className="whitespace-pre-line">
              {live
                .map((clash) =>
                  t("schedule.dayBoard.standingClash", {
                    name: clash.personName,
                    departure: clash.otherTitle,
                  }),
                )
                .join("\n")}
            </p>
          ) : (
            t("schedule.dayBoard.noCurrentClashes")
          )}
        </ShopNotice>
      ) : null}
    </>
  );
}
