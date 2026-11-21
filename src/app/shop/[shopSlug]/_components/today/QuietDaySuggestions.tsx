import Link from "next/link";
import { getDb } from "@/db/client";
import { readQuietDaySuggestions } from "@/features/day/today";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTime } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

/**
 * **A quiet day's suggestions** (issue #4257): at most two boats of the week
 * past the queue's horizon that already have a blocked diver, each linking to
 * its guests. Renders nothing when there is nothing real to suggest, so the
 * quiet day stays the pinned pair and its one act.
 */
export async function QuietDaySuggestions({
  shopId,
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  /** From the page's `requireShopSurface`, never re-read from the slug (security review N7). */
  shopId: string;
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const db = await getDb();
  const suggestions = await readQuietDaySuggestions(db, shopId, nowDate());
  if (suggestions.length === 0) return null;
  return (
    <section
      aria-labelledby="quiet-suggestions-heading"
      className="space-y-3"
      data-testid="quiet-suggestions"
    >
      <h2 id="quiet-suggestions-heading" className="font-semibold">
        {t("shopHome.quietSuggestions.heading")}
      </h2>
      <ul className="divide-y divide-border rounded-panel border border-border">
        {suggestions.map((boat) => (
          <li key={boat.tripId} className="space-y-1 px-4 py-3">
            <p className="font-medium break-words">
              <Link href={shopPath(shopSlug, "trips", boat.tripId)} className="hover:underline">
                {boat.title}
              </Link>
            </p>
            <p className="flex flex-wrap gap-x-2 text-sm text-muted tabular-nums">
              <span>
                {formatShortDate(boat.startsAt, locale, timeZone)} ·{" "}
                {formatTime(boat.startsAt, locale, timeZone)}
              </span>
              <span className="text-warning-strong">
                {t("shopHome.quietSuggestions.blocked", { count: boat.blocked })}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
