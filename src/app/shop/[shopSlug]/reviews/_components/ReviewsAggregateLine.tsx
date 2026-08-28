import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ReviewAggregate } from "@/lib/reviews";

/**
 * **How this shop is rated, said once** (ADR 20260827-people-not-lists,
 * decision 3; the language is 20260827-clearwater-surface-language).
 *
 * It replaces four stat tiles that between them stated two facts three times:
 * a "Public rating" tile, a "Published" count, a "Waiting on you" count sitting
 * beside a queue whose first group is now titled with the same number, and a
 * "Hidden" count sitting above a group titled with that one. The two counts
 * moved into the group labels that own them; the rating and the month's
 * reading became this line, and nothing on the page says either of them twice.
 * `ReviewsAggregateLine.test.tsx` pins the "once" — a second rating rendering
 * at header level is the regression this component exists to prevent.
 *
 * **It renders nothing before a shop has published anything.** An average of
 * no reviews is not a low score, and "—" under the title is a figure a reader
 * has to decode. The page's own empty state is the thing that speaks then.
 *
 * The month's reading is a separate sentence joined by a middot rather than one
 * interpolated clause: it is a second, separable fact (the same call
 * `ShopStat`'s `comparison` makes), and a translator gets two whole sentences
 * instead of a fragment.
 *
 * No accent ink: the coral budget's table gives this surface no moment
 * (clearwater decision 11). Moderation is work, not a celebration.
 */
export function ReviewsAggregateLine({
  aggregate,
  month,
  t,
  className = "",
}: {
  /** The shop's whole published record. */
  aggregate: ReviewAggregate;
  /** The same reading over the current calendar month, in the shop's own zone. */
  month: ReviewAggregate;
  t: StaffTranslator;
  className?: string;
}) {
  if (aggregate.count === 0 || aggregate.average === null) return null;
  const parts = [
    t("reviews.aggregate", {
      rating: aggregate.average.toFixed(1),
      count: aggregate.count,
    }),
  ];
  if (month.count > 0 && month.average !== null) {
    parts.push(
      t("reviews.aggregateMonth", { rating: month.average.toFixed(1), count: month.count }),
    );
  }
  return (
    <p className={`text-sm text-muted tabular-nums ${className}`.trim()}>{parts.join(" · ")}</p>
  );
}
