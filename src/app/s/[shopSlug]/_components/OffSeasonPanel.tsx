import { SectionCard } from "@/components/ui/card";
import type { DiverTranslator } from "@/i18n/messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatShortDate } from "@/lib/format";
import type { OffSeason } from "@/lib/off-season";

/**
 * The one sentence the card is allowed, already zoned and already worded.
 *
 * `formatShortDate` for the departure (a real instant, read in the shop's own
 * zone, the same words the week rows use). The shop's own typed "back on the
 * water" date only on an empty board (`offSeason`), as a calendar date with its
 * year: it can be most of a year away.
 */
export function offSeasonLine(
  t: DiverTranslator,
  quiet: Pick<OffSeason, "opensAt" | "reopensOn">,
  locale: string,
  timeZone: string,
): string | null {
  if (quiet.opensAt) {
    return t("schedule.offSeason.back", { date: formatShortDate(quiet.opensAt, locale, timeZone) });
  }
  if (quiet.reopensOn) {
    return t("schedule.offSeason.back", { date: formatCalendarDate(quiet.reopensOn, locale) });
  }
  return null;
}

/**
 * **The off-season, said out loud** (N-45).
 *
 * A shop with nothing on the books for the next month used to show a stranger
 * an empty schedule under "No trips on the books yet" — a sentence that reads
 * as a shop which has stopped rather than one which has not started, on the
 * one page that decides whether that stranger books anywhere at all.
 *
 * So the quiet becomes a state the storefront is designed for: one card that
 * says the board is quiet, names the soonest thing the shop has actually
 * written down when there is one, and hands the page's one primary to the
 * date-request composer immediately below it — which is the same arrangement
 * `NextBoatCard` already promises for a page with no bookable boat.
 *
 * **At most one date, and never one this page invents.** `line` is composed by
 * the page from either a departure the shop scheduled or a season it wrote
 * (`src/lib/off-season.ts`); a shop that has said neither gets the heading
 * alone rather than a reassuring sentence about a spring nobody has committed
 * to. There is deliberately no "check back soon" and no apology for the quiet:
 * the composer under it is the thing to do next, and a card saying so as well
 * would be a second manual path to what that button already offers.
 *
 * Never inside `?embed=1`, and never on the same page as the collapsed
 * date-request row further down — the ask is promoted here, not duplicated.
 */
export function OffSeasonPanel({
  heading,
  line,
}: {
  heading: string;
  /** "We're back out Mar 14." — already worded, already zoned, or null. */
  line: string | null;
}) {
  return (
    // No width and no margin of its own: the identity band's row owns both.
    <SectionCard as="section" title={heading} className="h-full">
      {line ? <p className="text-sm text-muted">{line}</p> : null}
    </SectionCard>
  );
}
