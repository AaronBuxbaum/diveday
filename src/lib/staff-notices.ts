/**
 * The `?notice=` → banner plumbing every page repeats: a page redirects
 * back to itself with a notice code, and the next render looks that code up
 * in its own map to decide a tone and some copy (docs ADR
 * 20260730-staff-copy-localization). ~11 pages hand-rolled the lookup half of
 * this (task 152, UX-persona Lens 17) — some safely (`Object.hasOwn`), some
 * with a bare `map[code]` a `?notice=constructor` query string can walk off
 * of. `noticeFromParam` is the one lookup, used everywhere a page keeps its
 * own `Record<code, ...>` of notices — the map's *shape* stays local to each
 * page (a plain `{tone, key}`, a pre-translated `{tone, text}`, or something
 * page-specific like a `countKey`), because the codes and copy are genuinely
 * different per surface. Only the "read this code out of that map, safely"
 * step is shared.
 *
 * Named for `/shop/**`, where the pattern started, but the lookup is not
 * staff-specific and the diver-facing bearer-token pages (`/waivers`,
 * `/ready`, `/recap`) read their own notice params through it too — a hostile
 * query string is a hostile query string on either side of the auth line.
 * `NoticeTone`/`noticeRole` below stay tied to the staff `ShopNotice` banner.
 */

/** The tone vocabulary `ShopNotice` accepts — kept here so a notice map never
 * has to redeclare the union and risk drifting from what the banner renders. */
export type NoticeTone = "success" | "danger" | "warning" | "neutral";

/**
 * The one spelling a notice code is allowed to have: lower-case kebab.
 *
 * The vocabulary had forked. Three meanings existed in *both* casings at once
 * — `not_authorized`/`not-authorized`, `payment_not_connected`/
 * `payment-not-connected`, `demo_disabled`/`demo-disabled` — and
 * `orders/new/page.tsx` emitted two casings of one concept on adjacent lines
 * of a single ternary, because the two destination pages' notice maps had been
 * written by different hands. The branch whose map had no matching key
 * rendered no banner at all: the refusal was silent, which is the one outcome
 * a refusal must never be.
 *
 * `scripts/check-notice-codes.mjs` (in `pnpm check:repo`) holds every *literal*
 * code in the tree to this pattern so the fork cannot reopen; `noticeCode`
 * below holds the *runtime* ones — a `result.reason` the domain layer spells
 * `snake_case` — to it as well.
 */
export const NOTICE_CODE_PATTERN = /^[a-z0-9-]+$/;

/**
 * A notice code in its one canonical spelling.
 *
 * `src/lib` and `src/db` answer in codes, and they answer in the casing their
 * own domain uses: `medical_attestation_required`, `not_found`, `trip_departed`.
 * Half the emitters used to pipe those straight into a URL and the other half
 * hand-translated them, which is precisely how the vocabulary forked. This is
 * the single translation point — every code passing through `noticeUrl` comes
 * out kebab, so a destination page's map only ever has to hold one spelling.
 *
 * Deliberately a normalisation and not a refusal: this runs inside a server
 * action on the failure path, and throwing here would turn a refusal a staffer
 * needs to read into a 500. Characters outside the pattern survive
 * normalisation but are then percent-encoded by `noticeUrl` and simply fail to
 * match any map key — an unrecognised code, which every page already handles.
 */
export function noticeCode(notice: string): string {
  return notice.toLowerCase().replaceAll("_", "-");
}

type Kebab<Code extends string> = Code extends `${infer Head}_${infer Rest}`
  ? `${Head}-${Kebab<Rest>}`
  : Code;

/**
 * `noticeCode` at the type level: the kebab spelling of a domain reason union.
 *
 * The check script (`scripts/check-notice-codes.mjs`) can prove every code in
 * the tree is spelled one way. What no grep can prove is that a page's
 * `Record<code, …>` map has an entry for every code its own domain union can
 * produce — a code with no entry renders no banner at all, which looks exactly
 * like a dead link and fails nothing. That is a type-system job, and this is the
 * piece that was missing: with it a page types its map
 * `Record<NoticeCodeOf<Reason>, …>` and both halves of the drift become compile
 * errors — a reason added to the union with no copy, and a map entry left behind
 * after a reason is removed.
 *
 * It found one on the day it was written: `checkInBooking`'s reason union
 * carried `already_checked_in` while the check-in queue's map did not (the code
 * path answers idempotent success instead, so nothing was red).
 *
 * The `string extends Reason` branch is load-bearing. Given the wide `string`,
 * every branch below answers `string`, `Record<string, …>` demands no particular
 * key, and the exhaustiveness check silently becomes decoration — from an edit
 * that reads like a loosening (`reason: string`, or a `(string & {})`
 * autocomplete member) rather than like switching a control off.
 *
 * It answers a **sentinel key** rather than `never`, which was the first attempt
 * and did nothing: `Record<never, …>` is the empty object type, satisfied by any
 * map at all, so the widening still compiled clean (caught by deliberately
 * widening `CheckInOutcome["reason"]` and watching `tsc` stay green). A key no
 * map will ever hold makes the widening a compile error at the map that lost its
 * guarantee, with the reason spelled out in the error text.
 */
export type WidenedNoticeReason =
  "NoticeCodeOf was given a widened reason union, so this map no longer proves anything";

export type NoticeCodeOf<Reason extends string> = string extends Reason
  ? WidenedNoticeReason
  : Kebab<Lowercase<Reason>>;

/**
 * A path under a shop's staff namespace, with every segment escaped.
 *
 * `shopSlug` reaches a server action as an ordinary argument — client-supplied,
 * like any other, and several actions never compare it to the session. The
 * `` `/shop/${shopSlug}/check-in` `` template it used to be interpolated into
 * therefore gave a caller the rest of the URL, in two ways that matter:
 *
 * - **Path traversal, same-origin.** `../../admin` normalises away the
 *   `/shop/` prefix entirely, so the refusal lands on a route nobody named.
 * - **Query and fragment rewriting.** A segment carrying `?` or `#` turns the
 *   rest of the path into a query of its own and detaches the `?notice=`
 *   appended after it — the refusal renders nowhere, silently.
 *
 * Not an *off-site* redirect: the literal `/shop/` prefix keeps the origin, so
 * `//host` yields `/shop///host/...` rather than a protocol-relative target.
 * That distinction is worth stating, because the first version of this comment
 * claimed the stronger threat, and a reviewer who tests a false claim concludes
 * the whole guard is decoration. `staff-notices.test.ts` asserts the two real
 * ones.
 */
export function shopPath(slug: string, ...segments: (string | number)[]): string {
  return `/shop/${[slug, ...segments].map((segment) => encodeURIComponent(String(segment))).join("/")}`;
}

/**
 * The write half of the `?notice=` pattern: the URL a surface redirects to in
 * order to say what just happened.
 *
 * There were 216 hand-built versions of this line, and hand-building it went
 * wrong in three ways that this fixes at the one door:
 *
 * - **The value went in raw.** `` `${back}?notice=${outcome.reason}` `` trusts
 *   a domain code to be URL-safe. Every value here is percent-encoded.
 * - **The casing forked.** See `noticeCode` above.
 * - **Extra params were concatenated.** `&bid=`, `&count=`, `&form=`, `&undo=`
 *   were appended by hand, each site re-deciding `?` versus `&`. Pass them as
 *   `extra`; an `undefined` value drops out rather than rendering the string
 *   `"undefined"` into the query.
 *
 * `path` may already carry a query (`?q=` a staffer was searching with) and may
 * end in a `#fragment` — several refusals scroll to the row they are about.
 * Both survive: the notice is merged into the query, ahead of the fragment.
 */
export function noticeUrl(
  path: string,
  notice: string,
  extra?: Record<string, string | number | undefined>,
): string {
  const hashAt = path.indexOf("#");
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  const query = [
    `notice=${encodeURIComponent(noticeCode(notice))}`,
    ...Object.entries(extra ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`),
  ].join("&");
  // A path that already ends in `?` or `&` needs neither separator; anything
  // else with a `?` in it is mid-query and needs `&`.
  const separator = /[?&]$/.test(base) ? "" : base.includes("?") ? "&" : "?";
  return `${base}${separator}${query}${hash}`;
}

/**
 * `danger` notices are refusals a staff member needs to notice over anything
 * else on the page, so they get `role="alert"`; everything else is ambient
 * confirmation (`role="status"`). The one rule every full-shape migration
 * (`StaffNoticeBanner`) applies, extracted so it can't drift between them.
 */
export function noticeRole(tone: NoticeTone): "status" | "alert" {
  return tone === "danger" ? "alert" : "status";
}

/**
 * Looks a `?notice=` value up in a page's own code→definition map.
 * `Object.hasOwn`, not a bare `notices[notice]`: `notice` is an
 * attacker-supplied query param, and `?notice=constructor` would otherwise
 * resolve to `Object.prototype.constructor` and render a bogus banner instead
 * of nothing. Returns `undefined` for an absent or unrecognized code either
 * way — callers that want a fallback for an unrecognized-but-present code
 * (a couple of pages do) still supply that themselves.
 */
export function noticeFromParam<Definition>(
  notice: string | undefined,
  notices: Record<string, Definition>,
): Definition | undefined {
  return notice !== undefined && Object.hasOwn(notices, notice) ? notices[notice] : undefined;
}

/**
 * A `?notice=` already resolved to words *and* to the form it belongs to.
 *
 * The `?notice=` pattern above answers "what happened"; it never answered
 * "where does that answer belong". Pages with one form got away with the
 * omission — every notice could only be about the one thing on screen. Pages
 * with six forms did not: the trip Overview resolved sixty codes into a single
 * banner under the `<h1>`, so a staffer who saved the requirements block two
 * screens down was told the outcome somewhere they were not looking.
 *
 * `form` names the form a code came from. A page resolves its notice once,
 * hands each form its own with `noticeForForm`, and each form renders it in its
 * action row (`FormStatus`, src/components/ui/form.tsx). `"page"` stays
 * available for the notices that really are about the page rather than one form
 * on it — a permission refusal that bounced the staffer here from elsewhere.
 */
export type FormNotice = { form: string; tone: NoticeTone; text: string };

/**
 * This form's notice, or nothing when the page's notice belongs to a different
 * one. Deliberately a function rather than an equality check at each call site:
 * a mistyped `form` name would otherwise fail silently as "no notice", which is
 * exactly the bug this whole mechanism exists to remove.
 */
export function noticeForForm<T extends FormNotice>(
  notice: T | undefined,
  form: string,
): T | undefined {
  // Generic rather than `FormNotice` in and out: a surface may widen the shape
  // with fields of its own — the diver record carries the `?notice=` code
  // itself, so it can tell its one earned moment from an ordinary success —
  // and routing must not narrow those away on the way through.
  return notice?.form === form ? notice : undefined;
}
