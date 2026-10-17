import { FilterChips } from "@/components/ui/FilterChips";
import type { StaffReviewNarrow } from "@/db/reviews";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **All / 3 stars and under / With a comment** (fourth UX review, item 30).
 *
 * The record runs to pages, and the review an owner most needs to read, the
 * 3-star one with words, was found by paging. These narrow both groups and
 * their counts alike (`narrowWhere` in src/db/reviews.ts), so a header never
 * counts rows the list does not show. Drawn only once there is something to
 * narrow: chips over an empty page are three controls that do nothing.
 */
export function ReviewNarrowChips({
  base,
  narrow,
  t,
}: {
  base: string;
  narrow: StaffReviewNarrow | null;
  t: StaffTranslator;
}) {
  return (
    <FilterChips
      label={t("reviews.narrow.label")}
      className="mb-6"
      chips={[
        { key: "all", href: base, active: narrow === null, label: t("reviews.narrow.all") },
        {
          key: "low",
          href: `${base}?show=low`,
          active: narrow === "low",
          label: t("reviews.narrow.low"),
        },
        {
          key: "comment",
          href: `${base}?show=comment`,
          active: narrow === "comment",
          label: t("reviews.narrow.comment"),
        },
      ]}
    />
  );
}

/** The page's URL with its page number swapped and the narrowing kept. */
export function reviewsPageHref(base: string, narrow: StaffReviewNarrow | null, page: number) {
  const query = new URLSearchParams();
  if (narrow) query.set("show", narrow);
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}
