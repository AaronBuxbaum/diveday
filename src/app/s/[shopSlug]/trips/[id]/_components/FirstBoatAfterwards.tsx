import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";
import { getDb } from "@/db/client";
import {
  type FirstBoatPick,
  readFirstBoatAfterwards,
} from "@/features/trips/first-boat-afterwards";
import type { DiverTranslator } from "@/i18n/messages";
import { embedTripPath } from "@/lib/embed-routes";
import { formatDayParts, formatTime } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";

/**
 * **One quiet row after a refresher** (issue #4898): the next easygoing
 * departure after the session, with its day, time and seats left, linking to
 * its own page. Nothing renders for a session that is not a refresher or when
 * no departure qualifies. A suggestion; the booking form and readiness are
 * untouched by it.
 */
export async function FirstBoatAfterwards({
  shop,
  trip,
  locale,
  isEmbed = false,
  now,
  t,
}: {
  shop: { id: string; slug: string; timezone: string };
  trip: Parameters<typeof readFirstBoatAfterwards>[1]["session"];
  locale: string;
  isEmbed?: boolean;
  now: Date;
  t: DiverTranslator;
}) {
  const { slug: shopSlug, timezone: timeZone } = shop;
  const db = await getDb();
  const pick: FirstBoatPick | null = await readFirstBoatAfterwards(db, {
    shopId: shop.id,
    now,
    session: trip,
  });
  if (!pick) return null;
  const day = formatDayParts(pick.startsAt, locale, timeZone);
  return (
    <section>
      <GroupLabel as="h2">{t("booking.firstBoatAfterwards")}</GroupLabel>
      <ul className="mt-2">
        <LedgerRow
          href={
            isEmbed ? embedTripPath(shopSlug, pick.tripId) : publicTripPath(shopSlug, pick.tripId)
          }
          linkLabel={pick.title}
          kind={{
            word: `${day.weekday} ${formatTime(pick.startsAt, locale, timeZone)}`,
            tone: "neutral",
          }}
          stacked
          trailing={
            <span className="text-sm text-muted tabular-nums">
              {t("fallback.spotsLeft", { count: pick.seatsOpen })}
            </span>
          }
        >
          <span className="block text-sm font-medium">{pick.title}</span>
        </LedgerRow>
      </ul>
    </section>
  );
}
