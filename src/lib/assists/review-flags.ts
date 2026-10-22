import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";

/**
 * **review-flags**: each pending review with a comment gets neutral chips, so
 * a staffer moderating forty reviews sees which three need a careful read.
 * Specified in docs/product/features/ai-ml.md ("assistive review-moderation").
 * Publishing stays a staff tap (`setReviewPublished`); nothing reads these
 * codes to publish, hide or reorder. Only the comment is sent: no name, no
 * trip, no rating.
 *
 * Contact details are also found by a plain pattern, so a phone number is
 * flagged even with the assist dark or wrong.
 */

export const REVIEW_FLAGS_FEATURE = "review_flags";

export const REVIEW_FLAGS = [
  "names_someone",
  "contact_info",
  "safety_complaint",
  "profanity",
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

/** Long enough for any review the form accepts; a longer one is cut, never sent whole. */
const MAX_COMMENT_SENT = 2_000;

export const REVIEW_FLAGS_SYSTEM = [
  "You help a dive shop moderate a diver's review before it is published. Mark which of these apply to the comment:",
  "- names_someone: names a person other than the shop, such as a crew member or another diver.",
  "- contact_info: contains a phone number, an email address or a social handle.",
  "- safety_complaint: describes a safety problem on the dive or the boat.",
  "- profanity: swears or insults.",
  "Mark none when none clearly apply. Never judge whether the review is fair.",
].join("\n");

const Flags = z.object({ flags: z.array(z.enum(REVIEW_FLAGS)) });

export function reviewFlagsCall(comment: string): StructuredCall<typeof Flags> {
  return {
    model: "quick",
    system: REVIEW_FLAGS_SYSTEM,
    content: `Comment: ${comment.slice(0, MAX_COMMENT_SENT)}`,
    schema: Flags,
    maxTokens: 300,
  };
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d[\s().-]?){7,}/;

/** The contact flag a pattern can find on its own. */
export function patternFlags(comment: string): ReviewFlag[] {
  return EMAIL.test(comment) || PHONE.test(comment) ? ["contact_info"] : [];
}

/** The chips for one comment, in the order the queue shows them, each once. */
export function reviewFlagsFor(
  comment: string,
  assisted: readonly ReviewFlag[] | null,
): ReviewFlag[] {
  const found = new Set<ReviewFlag>([...(assisted ?? []), ...patternFlags(comment)]);
  return REVIEW_FLAGS.filter((flag) => found.has(flag));
}

export function isReviewFlag(value: unknown): value is ReviewFlag {
  return (REVIEW_FLAGS as readonly unknown[]).includes(value);
}

export function reviewFlagsFixture(request: { messages: unknown }): unknown {
  const text = JSON.stringify(request.messages).toLowerCase();
  const flags: ReviewFlag[] = [];
  if (/\b(current|unsafe|scared|left behind)\b/.test(text)) flags.push("safety_complaint");
  return { flags };
}
