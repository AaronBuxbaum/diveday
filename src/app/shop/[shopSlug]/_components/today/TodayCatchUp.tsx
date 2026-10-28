import { Suspense } from "react";
import { CatchUpStrip } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/CatchUpStrip";
import { readTodayCatchUp } from "@/db/today-catch-up";
import { catchUpSentences } from "@/i18n/desk-event-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { groupCatchUp } from "@/lib/desk-events";
import { formatTime, formatTimeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { signTodayCatchUp } from "@/lib/today-catch-up-token";
import { shopDayBounds } from "@/lib/zoned";
import { InitializeTodayCatchUp } from "./InitializeTodayCatchUp";
import { markTodayCatchUp } from "./today-catch-up-actions";

export async function TodayCatchUp({ shopSlug, locale }: { shopSlug: string; locale: string }) {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const { id: shopId, timezone: timeZone } = shop;
  const personId = session.user.personId;
  const now = nowDate();
  const result = await readTodayCatchUp(db, { shopId, personId, now, timeZone });
  const mode = result.mark ? "ack" : "initialize";
  const token = signTodayCatchUp(
    { shopId, personId, dayStart: shopDayBounds(now, timeZone).from.toISOString(), mode },
    result.snapshotIds,
  );
  const action = markTodayCatchUp.bind(null, shopSlug, mode, token);
  if (!result.mark) return <InitializeTodayCatchUp action={action} />;
  const t = staffTranslator(locale);
  const trips = new Map<string, typeof result.events>();
  for (const event of result.events)
    trips.set(event.tripId, [...(trips.get(event.tripId) ?? []), event]);
  const sentences = [...trips.values()].flatMap((events) => {
    const first = events[0];
    if (!first) return [];
    const changes = catchUpSentences(t, locale, groupCatchUp(events));
    return changes.length
      ? [
          t("manifest.catchUp.todayTrip", {
            trip: first.tripTitle,
            time: formatTime(first.tripStartsAt, locale, timeZone),
            changes: changes.join(" "),
          }),
        ]
      : [];
  });
  return (
    <>
      <span hidden aria-hidden="true" data-today-catch-up-state="ready" />
      <CatchUpStrip
        idPrefix="today"
        label={t("manifest.catchUp.todayLabel", {
          time: formatTimeTz(result.mark.at, locale, timeZone),
        })}
        sentences={sentences}
        dismissSize="md"
        dismissLabel={t("manifest.catchUp.dismiss")}
        dismissAction={action}
      />
    </>
  );
}

export function TodayCatchUpSlot({ shopSlug, locale }: { shopSlug: string; locale: string }) {
  return (
    <Suspense fallback={null}>
      <TodayCatchUp shopSlug={shopSlug} locale={locale} />
    </Suspense>
  );
}
