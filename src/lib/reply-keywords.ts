import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";
import { MINUTE_MS } from "./clock";

/**
 * **What a one-word reply means, and how a cancellation is confirmed** (ADR
 * 20260909-reply-keywords).
 *
 * A trip reminder now ends with a line offering two replies: one to release
 * the seat, one to ask about moving it. What comes back arrives on the
 * two-way inbox N-20 built (ADR 20260907-two-way-inbox) — an unauthenticated
 * channel where the only evidence of who is writing is an address the
 * provider vouched for. So nothing here decides anything on its own: it
 * recognises a token, and `src/db/reply-keywords.ts` decides what may follow.
 *
 * Two rules shape the file.
 *
 * **The keywords are fixed, the sentence that teaches them is translated.** A
 * letter typed back into a text box is a token in a protocol, not prose. If
 * the accepted letter were read out of the reader's own locale, a diver whose
 * language changed between the reminder and the reply would type the letter
 * they were shown and be told it meant nothing, and every locale ever added
 * would widen what the parser must accept. `C` and `M` also happen to be the
 * initials in both languages DiveDay ships (cancel and cancelar, move and
 * mover), which is what makes the fixed choice cheap rather than
 * merely convenient. The whole words are accepted too, in both languages, so
 * a diver who types what they mean is understood.
 *
 * **A confirmation code is signed, never stored.** The same
 * stateless-signed-token shape as `recap-links.ts`, with its own HKDF-derived
 * key so a code minted here can never be a recap link and vice versa. It is
 * short because a person types it back, and it is bound to the booking, the
 * diver, the channel and the address it was sent to, so a code seen anywhere
 * else cancels nothing. Expiry is a coarse window folded into the signature
 * rather than a row somebody has to prune.
 */

/** What a recognised keyword is asking for. Matches the `inbound_keyword_intent` pgEnum. */
export type ReplyKeywordIntent = "cancel" | "move";

export type ReplyKeywordParse =
  | { kind: "intent"; intent: ReplyKeywordIntent }
  | { kind: "code"; code: string }
  | { kind: "none" };

/**
 * How long a reply may be and still be read as a keyword.
 *
 * The point is not to save work: it is that a diver writing a sentence must
 * never have it interpreted as a command. Anything longer than a word or two
 * goes to the shop inbox untouched, which is where every message went before
 * this file existed.
 */
export const KEYWORD_MAX_LENGTH = 24;

/**
 * The tokens each intent answers to — the fixed letter plus the whole word in
 * both shipped languages, compared after {@link normalizeKeywordBody} has
 * taken the accents and punctuation off. Not copy: nothing here is ever shown
 * to anybody, and the sentence that teaches `C` lives in the diver bundle.
 */
const KEYWORD_TOKENS: Record<ReplyKeywordIntent, readonly string[]> = {
  cancel: ["c", "cancel", "cancelar", "cancelacion"],
  move: ["m", "move", "mover", "cambiar", "cambio"],
};

/**
 * The alphabet a confirmation code is drawn from: digits and capitals with the
 * five characters people mistype for each other (`0`/`O`, `1`/`I`/`L`) left
 * out, so a code read off a phone screen and typed back lands.
 *
 * 31 characters over {@link CONFIRMATION_CODE_LENGTH} places is about 9 × 10^8
 * codes. That is the *second* line of defence and not the first — a code is
 * only ever accepted from an address the provider vouched for, which already
 * has to be a diver on the shop's roster, and `src/db/reply-keywords.ts` caps
 * how many messages from one address it will read keywords out of at all.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CONFIRMATION_CODE_LENGTH = 6;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CONFIRMATION_CODE_LENGTH}}$`);

/**
 * How coarse the window folded into a code's signature is, and therefore how
 * long a code lives: at least one window, at most two, because verification
 * accepts the current one and the one before it. Thirty minutes is long enough
 * for a diver to put the phone down and come back, and short enough that a
 * code read over someone's shoulder is stale by the time it is useful.
 */
export const CONFIRMATION_WINDOW_MS = 30 * MINUTE_MS;

/**
 * Everything a code is bound to. Change any of these and the code changes:
 * a code minted for one seat cannot cancel another, and one sent to a phone
 * cannot be replayed from a mailbox.
 */
export type ConfirmationCodeSubject = {
  shopId: string;
  bookingId: string;
  personId: string;
  channel: string;
  /** The normalised address the code was sent to, exactly as the row stores it. */
  toAddress: string;
};

/**
 * A reply reduced to something comparable: lowercased, stripped of accents and
 * of the punctuation a phone keyboard adds on its own ("C.", "«C»", "C!"), with
 * whitespace collapsed.
 *
 * Accent folding is what lets `cancelación` reach `cancelacion` without the
 * table above carrying both spellings, and it is safe here precisely because
 * the result is only ever compared against a fixed token list — no accented
 * word is being displayed, stored, or matched against a diver's own text.
 */
export function normalizeKeywordBody(body: string): string {
  return body
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toLowerCase();
}

/**
 * What a diver's message is, as far as this feature is concerned.
 *
 * Intents are matched before codes so a word can never be read as a code by
 * accident — and the alphabet's own exclusions already rule out the words we
 * accept (`CANCEL` carries an `L`, `MOVER` is five characters), which is a
 * property `reply-keywords.test.ts` pins rather than a coincidence to rely on.
 */
export function parseReplyKeyword(body: string): ReplyKeywordParse {
  const normalized = normalizeKeywordBody(body);
  if (normalized.length === 0 || normalized.length > KEYWORD_MAX_LENGTH) return { kind: "none" };
  for (const [intent, tokens] of Object.entries(KEYWORD_TOKENS) as [
    ReplyKeywordIntent,
    readonly string[],
  ][]) {
    if (tokens.includes(normalized)) return { kind: "intent", intent };
  }
  const upper = normalized.toUpperCase();
  return CODE_PATTERN.test(upper) ? { kind: "code", code: upper } : { kind: "none" };
}

function codeSecret(): string {
  // Production refuses to boot without `AUTH_SECRET`; this is only ever unset
  // in dev and e2e, where `auth-secret.ts` supplies a fixed fallback. Fail
  // loud rather than sign a cancellation code with an empty key.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign reply-keyword codes.");
  return Buffer.from(hkdfSync("sha256", authSecret, "", "diveday-reply-keyword", 32)).toString(
    "base64url",
  );
}

function codeForWindow(subject: ConfirmationCodeSubject, windowIndex: number): string {
  const payload = [
    "reply-cancel",
    subject.shopId,
    subject.bookingId,
    subject.personId,
    subject.channel,
    subject.toAddress,
    String(windowIndex),
  ].join(":");
  const digest = createHmac("sha256", codeSecret()).update(payload).digest();
  let code = "";
  for (let index = 0; index < CONFIRMATION_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[digest[index] % CODE_ALPHABET.length];
  }
  return code;
}

/** The code to put in front of a diver right now. */
export function confirmationCode(subject: ConfirmationCodeSubject, nowMs: number): string {
  return codeForWindow(subject, Math.floor(nowMs / CONFIRMATION_WINDOW_MS));
}

/**
 * Whether a typed code is the one this seat was offered, in this window or the
 * one before it.
 *
 * Compared with {@link timingSafeEqual} for the usual reason, and over equal
 * lengths by construction — both sides are exactly
 * {@link CONFIRMATION_CODE_LENGTH} characters of the same alphabet, and a
 * candidate that is not has already failed {@link parseReplyKeyword}.
 */
export function confirmationCodeMatches(
  candidate: string,
  subject: ConfirmationCodeSubject,
  nowMs: number,
): boolean {
  if (!CODE_PATTERN.test(candidate)) return false;
  const current = Math.floor(nowMs / CONFIRMATION_WINDOW_MS);
  const typed = Buffer.from(candidate, "utf8");
  let matched = false;
  // Both windows are always checked, rather than short-circuiting on the
  // first: the loop's cost is two HMACs and its timing should not say which
  // window a code came from.
  for (const windowIndex of [current, current - 1]) {
    const expected = Buffer.from(codeForWindow(subject, windowIndex), "utf8");
    if (expected.length === typed.length && timingSafeEqual(expected, typed)) matched = true;
  }
  return matched;
}
