import { cachedFormatter } from "@/lib/intl-cache";

/**
 * The name of a timezone as a reader sees it — "EDT", "CEST", "GMT+8".
 *
 * `src/lib/format.ts` already renders a zone *attached to a time*
 * (`formatTimeRangeTz`, `formatDateTimeTz`), which is the right shape wherever
 * one figure needs labelling. What it has no helper for is the zone on its own,
 * which is what a page-level statement needs: a schedule listing twenty
 * departures should say once whose clock they are on, not append "EDT" twenty
 * times (review finding I18N-L2). This lives in `src/i18n/` for the same reason
 * `currency-labels.ts` does — it resolves a *label* from CLDR for a locale, and
 * the words are the UI's business rather than the domain layer's.
 *
 * **Short, not long.** `timeZoneName: "short"` gives "EDT" where a common
 * abbreviation exists and a "GMT-4" offset where none does, which is the pair a
 * cross-timezone booker can actually act on — an offset is unambiguous, and
 * "Eastern Daylight Time" spelled out crowds the line it sits on without saying
 * anything more. It also matches what `formatTimeRangeTz` and `formatDateTimeTz`
 * already render everywhere else in the app, so one shop's times never wear two
 * different names for the same zone.
 *
 * The zone name depends on the *instant*: the same shop is "EST" in January and
 * "EDT" in July. `at` is therefore required, and callers pass a date inside the
 * range they are labelling — never `nowDate()` when the times on screen are in
 * another season.
 *
 * Falls back to the IANA name itself if the runtime somehow yields no zone part,
 * which is still true and still better than an unlabelled time.
 */
export function timeZoneLabel(at: Date, locale: string, timeZone: string): string {
  const parts = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    hour: "numeric",
    timeZoneName: "short",
    timeZone,
  }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}
