import type { ReviewModerationReason } from "@/features/reviews";
import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The reason codes as words. `src/db` returns codes and this picks the
 * sentences, the same division every other domain code on this page follows
 * (ADR 20260731-domain-layer-copy-leaks).
 */
export const REVIEW_REASON_KEYS: Record<ReviewModerationReason, StaffMessageKey> = {
  abusive: "reviews.hideReason.abusive",
  names_a_person: "reviews.hideReason.namesAPerson",
  wrong_subject: "reviews.hideReason.wrongSubject",
  spam: "reviews.hideReason.spam",
  other: "reviews.hideReason.other",
};

/*
 * **This page has no `?notice=` map any more, and nothing here redirects.**
 *
 * Every outcome on this list used to arrive as a query parameter on a fresh
 * navigation — publish, hide, standout, bulk publish and their four refusals —
 * which meant a full-page bounce per tap and a staffer working down a queue
 * being thrown back to the top of it each time. The controls now settle in
 * place and report beside themselves (`ReviewRowActions`, `PublishAllStatus`),
 * so the map, the `?published=` count it had to defend against tampering, and
 * the page banner they fed are all gone with the redirects that wrote them.
 * The one banner left is `ratingWithheld`, which is a fact about the page
 * rather than the outcome of a tap.
 *
 * **One exception, added with the private pulse** (slice 16i). Marking a pulse
 * addressed takes its row out of a panel that is itself gone once the last one
 * goes, so a settle-in-place control would settle into nothing and a staffer
 * who just acted on somebody's complaint would watch the page go quiet. That
 * one act redirects with a `?notice=`, read below through `noticeFromParam`.
 */
export const PULSE_NOTICES: Record<string, { tone: "success" | "danger"; key: StaffMessageKey }> = {
  "pulse-addressed": { tone: "success", key: "reviews.notice.pulseAddressed" },
  "pulse-not-authorized": { tone: "danger", key: "reviews.notice.pulseNotAuthorized" },
  error: { tone: "danger", key: "reviews.notice.error" },
  "review-url-saved": { tone: "success", key: "settings.main.notice.reviewUrlSaved" },
  "review-url-invalid": { tone: "danger", key: "settings.main.notice.reviewUrlInvalid" },
};
