import { staffingGapWords } from "@/app/shop/[shopSlug]/staffing/_components/gap-words";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { AppDb } from "@/db/client";
import { type CrewWeekLine, crewWeekFor } from "@/db/crew-week";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { staffRoleLabel } from "@/i18n/staff-role-labels";
import { formatShortDate, formatTime, formatWeekdayTime, isSameCalendarDay } from "@/lib/format";
import { GAP_TONE } from "@/lib/staffing-week";
import { addCalendarDays, shopDayBounds, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";

/** Tomorrow and the six days after it: the week a crew member checks the night before. */
const WEEK_DAYS = 7;

/**
 * **"Your week"** — a crew member's next three departures, under the day on
 * Today: the boat, when, their job, and the one thing still missing on it.
 * Today already badges the boat they crew today ("You're crewing"); this is
 * the Sunday-night question, answered without the owner's staffing page or
 * an iCalendar feed. Renders nothing for a reader rostered on nothing.
 *
 * **Any role with an assignment** (fourth review, item 14): an instructor
 * rostered on Thursday's wreck charter never saw it, because the strip was the
 * boat lens's. Whoever holds the assignment reads it here, less what "Your
 * sessions" above already lists.
 */
export async function YourWeek({
  db,
  shopId,
  shopSlug,
  personId,
  timeZone,
  locale,
  now,
  diversPerDivemaster,
  listedTripIds = [],
}: {
  db: AppDb;
  shopId: string;
  shopSlug: string;
  personId: string;
  timeZone: string;
  locale: string;
  now: Date;
  diversPerDivemaster: number;
  /** Departures the page already lists for this reader ("Your sessions"), said once. */
  listedTripIds?: readonly string[];
}) {
  const from = shopDayBounds(now, timeZone).to;
  const wall = utcToWallTime(from, timeZone);
  const to = wallTimeToUtc(addCalendarDays({ ...wall, hour: 0, minute: 0 }, WEEK_DAYS), timeZone);
  const lines = await crewWeekFor(db, {
    shopId,
    personId,
    from,
    to,
    diversPerDivemaster,
    now,
    excludeTripIds: listedTripIds,
  });
  if (lines.length === 0) return null;
  const t = staffTranslator(locale);
  return (
    <YourWeekList lines={lines} shopSlug={shopSlug} timeZone={timeZone} locale={locale} t={t} />
  );
}

/** The strip itself, from lines already read. */
export function YourWeekList({
  lines,
  shopSlug,
  timeZone,
  locale,
  t,
}: {
  lines: readonly CrewWeekLine[];
  shopSlug: string;
  timeZone: string;
  locale: string;
  t: StaffTranslator;
}) {
  const gapWords = staffingGapWords(t);
  return (
    <LedgerGroup
      as="h2"
      id="your-week-heading"
      label={t("today.yourWeek.heading")}
      className="mt-10"
    >
      <ul>
        {lines.map((line) => (
          <LedgerRow
            key={line.tripId}
            href={`/shop/${shopSlug}/trips/${line.tripId}`}
            linkLabel={t("today.yourWeek.openTrip", { title: line.title })}
          >
            <div className="min-w-0">
              <p className="font-medium break-words">
                {line.boatName ? `${line.boatName} · ${line.title}` : line.title}
              </p>
              <p className="mt-0.5 text-sm text-muted tabular-nums">
                {formatShortDate(line.startsAt, locale, timeZone)} ·{" "}
                {line.crewCall
                  ? t(
                      // Their own shift or the shop's crew time (H-20261022-crew-arrive-before-divers) is
                      // theirs; the divers' call is named as the divers'.
                      line.crewCall.source === "divers"
                        ? "today.yourWeek.diversAtTheDock"
                        : "today.yourWeek.atTheDock",
                      {
                        // A call the evening before names its own day, never
                        // the departure's (dive-domain review of layer 1).
                        dock: isSameCalendarDay(line.crewCall.at, line.startsAt, timeZone)
                          ? formatTime(line.crewCall.at, locale, timeZone)
                          : formatWeekdayTime(line.crewCall.at, locale, timeZone),
                        leaves: formatTime(line.startsAt, locale, timeZone),
                      },
                    )
                  : formatTime(line.startsAt, locale, timeZone)}{" "}
                · {line.tripRole ? staffRoleLabel(t, line.tripRole) : t("today.yourWeek.roleUnset")}
              </p>
              {line.gap ? (
                <p
                  className={`mt-1 text-sm font-medium ${
                    GAP_TONE[line.gap] === "warning" ? "text-warning-strong" : "text-muted"
                  }`}
                >
                  {gapWords[line.gap]}
                </p>
              ) : null}
            </div>
          </LedgerRow>
        ))}
      </ul>
    </LedgerGroup>
  );
}
