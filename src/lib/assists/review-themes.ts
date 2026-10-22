import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { promptLanguage, VOICE_RULES } from "./facts";

/**
 * **themes**: once a month, the last ninety days of *published* reviews become
 * three to five recurring themes for the owner, each with the reviews that
 * carry it. The stored answer holds review ids, never quotes: the quote is read
 * from the review row when the page renders, so an unpublished or erased
 * review leaves the theme with it.
 */

export const REVIEW_THEMES_FEATURE = "review_themes";
export const REVIEW_THEMES_WINDOW_DAYS = 90;
/** Fewer comments than this and a "theme" is one diver's opinion. */
export const REVIEW_THEMES_MIN_COMMENTS = 5;
const MAX_COMMENTS = 150;
const MAX_COMMENT_SENT = 600;

export const REVIEW_THEMES_SYSTEM = [
  "You read a dive shop's published diver reviews from the last ninety days and find the three to five things divers mention again and again, good or bad.",
  "Each theme is a short title of at most six words and the ids of the reviews that mention it, at least two reviews each.",
  "Only themes that several reviews share. Use only the ids given.",
  VOICE_RULES,
].join("\n");

const Themes = z.object({
  themes: z.array(z.object({ title: z.string(), reviewIds: z.array(z.string()) })),
});

export type ThemeInput = { readonly id: string; readonly comment: string };
export type ReviewTheme = { title: string; reviewIds: string[] };

export function reviewThemesCall(
  reviews: readonly ThemeInput[],
  locale: string,
): StructuredCall<typeof Themes> {
  const sent = reviews.slice(0, MAX_COMMENTS).map((review, index) => ({
    id: `r${index + 1}`,
    comment: review.comment.slice(0, MAX_COMMENT_SENT),
  }));
  return {
    model: "quick",
    system: REVIEW_THEMES_SYSTEM,
    content: JSON.stringify({ language: promptLanguage(locale), reviews: sent }),
    schema: Themes,
    maxTokens: 1_500,
  };
}

/**
 * The themes to keep: real ids only (the prompt's `r1`… mapped back to rows),
 * at least two reviews each, three to five in all, or none.
 */
export function reviewThemes(
  value: z.infer<typeof Themes> | null,
  reviews: readonly ThemeInput[],
): ReviewTheme[] {
  if (!value) return [];
  const idFor = new Map(
    reviews.slice(0, MAX_COMMENTS).map((review, index) => [`r${index + 1}`, review.id]),
  );
  const themes = value.themes.flatMap((theme) => {
    const title = theme.title.trim();
    const ids = [...new Set(theme.reviewIds.flatMap((id) => idFor.get(id) ?? []))];
    if (!title || title.length > 60 || ids.length < 2) return [];
    return [{ title, reviewIds: ids }];
  });
  return themes.length >= 3 ? themes.slice(0, 5) : [];
}

export function reviewThemesFixture(request: { messages: unknown }): unknown {
  const ids = [...JSON.stringify(request.messages).matchAll(/\\"(r\d+)\\"/g)].map(
    (match) => match[1],
  );
  const pick = (start: number) => ids.slice(start, start + 2);
  return {
    themes: [
      { title: "The crew’s briefings", reviewIds: pick(0) },
      { title: "Calm, roomy boat", reviewIds: pick(1) },
      { title: "Turtles at the wall", reviewIds: pick(2) },
    ],
  };
}
