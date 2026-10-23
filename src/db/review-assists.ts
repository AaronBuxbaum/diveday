import { and, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import {
  isReviewFlag,
  REVIEW_FLAGS_FEATURE,
  type ReviewFlag,
  reviewFlagsCall,
  reviewFlagsFor,
} from "@/lib/assists/review-flags";
import {
  REVIEW_THEMES_FEATURE,
  REVIEW_THEMES_MIN_COMMENTS,
  REVIEW_THEMES_WINDOW_DAYS,
  type ReviewTheme,
  reviewThemes,
  reviewThemesCall,
} from "@/lib/assists/review-themes";
import { sourceDigest } from "@/lib/assists/shop-translate";
import { DAY_MS, nowDate } from "@/lib/clock";
import { readAssistResult, readAssistResults, saveAssistResult } from "./assist-results";
import { type AssistOptions, runAssistOutcome } from "./assists";
import type { AppDb } from "./client";
import { tripReviews } from "./schema";

/**
 * The review assists' reads and writes (`src/lib/assists/review-flags.ts`,
 * `src/lib/assists/review-themes.ts`). Neither publishes, hides or orders a
 * review: the chips and the themes are read beside the queue, and
 * `setReviewPublished` stays the staff tap it was.
 */

/** How many waiting reviews one queue visit reads, so a backlog is worked off a page at a time. */
export const REVIEW_FLAGS_PER_VISIT = 10;

type Commented = { readonly id: string; readonly comment: string | null };

/**
 * The chips for each review with a comment: the stored answer while the
 * comment is the one it read, and the contact pattern always.
 */
export async function readReviewFlags(
  db: AppDb,
  shopId: string,
  reviews: readonly Commented[],
): Promise<Map<string, ReviewFlag[]>> {
  const commented = reviews.filter((review): review is { id: string; comment: string } =>
    Boolean(review.comment?.trim()),
  );
  const stored = await readAssistResults(
    db,
    shopId,
    REVIEW_FLAGS_FEATURE,
    commented.map((review) => review.id),
  );
  const flags = new Map<string, ReviewFlag[]>();
  for (const review of commented) {
    const row = stored.get(review.id);
    const fresh = row && row.inputDigest === sourceDigest(review.comment);
    const assisted = fresh ? storedFlags(row.value) : null;
    const chips = reviewFlagsFor(review.comment, assisted);
    if (chips.length > 0) flags.set(review.id, chips);
  }
  return flags;
}

function storedFlags(value: unknown): ReviewFlag[] {
  const flags = (value as { flags?: unknown } | null)?.flags;
  return Array.isArray(flags) ? flags.filter(isReviewFlag) : [];
}

/**
 * Reads the waiting reviews nobody has asked about yet (or whose comment
 * changed), at most `REVIEW_FLAGS_PER_VISIT`. Run after the queue renders; the
 * next visit shows the chips. A dark assist stores nothing.
 *
 * The calls run one after another, so the last may start many minutes after
 * the comments were read: each carries `readAt`, the caller's read time or
 * this function's start, so an erasure in between keeps none of their words
 * (`src/db/claude-call-content.ts`).
 */
export async function flagWaitingReviews(
  db: AppDb,
  shopId: string,
  reviews: readonly Commented[],
  options: AssistOptions = {},
): Promise<number> {
  const readAt = options.readAt ?? nowDate();
  const commented = reviews.filter((review): review is { id: string; comment: string } =>
    Boolean(review.comment?.trim()),
  );
  const stored = await readAssistResults(
    db,
    shopId,
    REVIEW_FLAGS_FEATURE,
    commented.map((review) => review.id),
  );
  const unread = commented
    .filter((review) => stored.get(review.id)?.inputDigest !== sourceDigest(review.comment))
    .slice(0, REVIEW_FLAGS_PER_VISIT);
  let read = 0;
  for (const review of unread) {
    const { status, value } = await runAssistOutcome(db, {
      ...options,
      readAt,
      shopId,
      feature: REVIEW_FLAGS_FEATURE,
      call: reviewFlagsCall(review.comment),
    });
    // Nothing came back (dark, over the cap, in flight, a provider error):
    // left unread, so a later visit asks again.
    if (status === "skipped") continue;
    // A refused or unusable answer is stored as no flags: asking again would
    // cost the same for the same answer, and it must not hold the reviews
    // behind it out of the slots.
    await saveAssistResult(db, {
      shopId,
      feature: REVIEW_FLAGS_FEATURE,
      subjectKey: review.id,
      value: { flags: value?.flags ?? [] },
      inputDigest: sourceDigest(review.comment),
    });
    read += 1;
  }
  return read;
}

/** `YYYY-MM` in UTC: one set of themes a month, whatever the shop's zone. */
export function themesMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** The published reviews the themes read: the last ninety days, with words. */
async function themeInputs(db: AppDb, shopId: string, now: Date) {
  const rows = await db
    .select({ id: tripReviews.id, comment: tripReviews.comment })
    .from(tripReviews)
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.isPublished, true),
        isNotNull(tripReviews.comment),
        ne(tripReviews.comment, ""),
        gte(tripReviews.publishedAt, new Date(now.getTime() - REVIEW_THEMES_WINDOW_DAYS * DAY_MS)),
      ),
    )
    // diveday:allow-time-id-order: the order the themes prompt numbers reviews in (r1, r2…); nobody is shown it
    .orderBy(desc(tripReviews.publishedAt), desc(tripReviews.id));
  return rows.flatMap((row) => (row.comment ? [{ id: row.id, comment: row.comment }] : []));
}

export type ShownTheme = { title: string; quotes: { id: string; comment: string }[] };

/**
 * This month's themes as the owner reads them: each title with the reviews
 * that carry it, quoted from the rows as they stand now. A review since hidden,
 * erased or emptied drops out, and a theme left with fewer than two goes too.
 */
export async function readReviewThemes(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<ShownTheme[]> {
  const stored = await readAssistResult(db, shopId, REVIEW_THEMES_FEATURE, themesMonth(now));
  const themes = ((stored?.value as { themes?: ReviewTheme[] } | null)?.themes ?? []).filter(
    (theme) => typeof theme?.title === "string" && Array.isArray(theme.reviewIds),
  );
  const ids = [...new Set(themes.flatMap((theme) => theme.reviewIds))];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: tripReviews.id, comment: tripReviews.comment })
    .from(tripReviews)
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.isPublished, true),
        inArray(tripReviews.id, ids),
      ),
    );
  const live = new Map(rows.flatMap((row) => (row.comment?.trim() ? [[row.id, row.comment]] : [])));
  return themes.flatMap((theme) => {
    const quotes = theme.reviewIds.flatMap((id) => {
      const comment = live.get(id);
      return comment ? [{ id, comment }] : [];
    });
    return quotes.length >= 2 ? [{ title: theme.title, quotes: quotes.slice(0, 2) }] : [];
  });
}

/**
 * Asks for this month's themes once: nothing when they are already stored,
 * when the shop has too few published words, or when the assist is dark.
 */
export async function refreshReviewThemes(
  db: AppDb,
  shopId: string,
  locale: string,
  now: Date = nowDate(),
  options: AssistOptions = {},
): Promise<boolean> {
  const month = themesMonth(now);
  if (await readAssistResult(db, shopId, REVIEW_THEMES_FEATURE, month)) return false;
  const inputs = await themeInputs(db, shopId, now);
  if (inputs.length < REVIEW_THEMES_MIN_COMMENTS) return false;
  const { status, value } = await runAssistOutcome(db, {
    ...options,
    shopId,
    feature: REVIEW_THEMES_FEATURE,
    call: reviewThemesCall(inputs, locale),
  });
  if (status === "skipped") return false;
  // A refused or unusable answer is stored as no themes, so the month is
  // asked once.
  await saveAssistResult(db, {
    shopId,
    feature: REVIEW_THEMES_FEATURE,
    subjectKey: month,
    value: { themes: value ? reviewThemes(value, inputs) : [] },
    inputDigest: sourceDigest(inputs.map((input) => input.id).join(",")),
  });
  return true;
}
