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
export function noticeForForm(
  notice: FormNotice | undefined,
  form: string,
): FormNotice | undefined {
  return notice?.form === form ? notice : undefined;
}
