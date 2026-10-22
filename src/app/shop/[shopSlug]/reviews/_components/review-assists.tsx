import { after } from "next/server";
import { GroupLabel } from "@/components/ui/group-label";
import { assistsAvailable } from "@/db/assists";
import type { AppDb } from "@/db/client";
import {
  flagWaitingReviews,
  readReviewFlags,
  readReviewThemes,
  refreshReviewThemes,
  type ShownTheme,
} from "@/db/review-assists";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ReviewFlag } from "@/lib/assists/review-flags";

/**
 * **Claude's read of the review queue** (ADR 20261018-claude-assists): chips
 * on a waiting comment worth a second read (`review-flags`), and, for whoever
 * runs the settings, this month's themes across the published words
 * (`themes`). Both show what earlier visits stored; the asking runs after the
 * response, so the queue never waits on Claude. Dark, both are empty.
 */
export type ReviewAssists = {
  flags: ReadonlyMap<string, ReviewFlag[]>;
  themes: ShownTheme[];
};

export async function loadReviewAssists(
  db: AppDb,
  shop: { id: string; defaultLocale: string },
  waiting: readonly { id: string; comment: string | null }[],
  canManageSettings: boolean,
): Promise<ReviewAssists> {
  const shopId = shop.id;
  if (!(await assistsAvailable(db, shopId))) return { flags: new Map(), themes: [] };
  const [flags, themes] = await Promise.all([
    readReviewFlags(db, shopId, waiting),
    canManageSettings ? readReviewThemes(db, shopId) : Promise.resolve([]),
  ]);
  after(async () => {
    await flagWaitingReviews(db, shopId, waiting);
    if (canManageSettings) await refreshReviewThemes(db, shopId, shop.defaultLocale);
  });
  return { flags, themes };
}

/** One waiting review's chips, as words. */
export function reviewFlagWords(assists: ReviewAssists, reviewId: string, t: StaffTranslator) {
  return (assists.flags.get(reviewId) ?? []).map((flag) => t(`deskAssists.reviewFlags.${flag}`));
}

/** This month's themes, each with two published reviews that carry it, quoted as they stand. */
export function ReviewThemes({ themes, t }: { themes: readonly ShownTheme[]; t: StaffTranslator }) {
  if (themes.length === 0) return null;
  return (
    <section aria-labelledby="reviews-themes">
      <GroupLabel as="h2" id="reviews-themes">
        {t("deskAssists.themes.heading")}
      </GroupLabel>
      <ul className="mt-2 space-y-3">
        {themes.map((theme) => (
          <li key={theme.title}>
            <p className="font-medium">{theme.title}</p>
            {theme.quotes.map((quote) => (
              <blockquote
                key={quote.id}
                className="mt-1 break-words border-s-2 border-border ps-3 text-sm text-muted text-pretty"
              >
                {quote.comment}
              </blockquote>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
