import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ReadinessBar } from "@/components/ui/ProgressBar";
import { INLINE_LINE_BOX } from "@/components/ui/StatusMark";
import { FIGURE_INLINE_CLASS, ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { staffDiveIntentLine } from "@/i18n/dive-intent-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { sayHelloSentences } from "@/i18n/welcome-cue-labels";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { formatMoneyScanned, formatTime } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import type { DayStation as DayStationData } from "@/lib/today";
import { STAGE_TONE } from "@/lib/trip-stage-tone";
import { STAGE_WORD_KEYS } from "@/lib/trip-stages";

/**
 * One departure on Today — ADR 20261001-logbook, decision 4, which supersedes
 * the station panel that ADR 20260904-reef-all-the-way-down's slice 16a drew
 * here (the site tile, the water dial, the rows inside the panel).
 *
 * A card that answers three questions at a glance: when it leaves, where it is
 * in its day (the stage pill: the crew's own word, the one the departure
 * header and the manifest strip show, `boatStageOf`), and how ready its divers
 * are (the bar). The
 * work that hangs off a departure is no longer drawn inside it: every job on
 * the day is one ranked "Needs you" list under the departures, each row naming
 * its boat by time.
 *
 * One safety sentence stays on the card, because it is not a job anybody taps
 * here and describes a checkpoint: a full boat whose **crew** roll call is
 * still open (issue #789). A blocked diver who is **already aboard** (issue
 * #791) used to be a second one; it is a `blocked_aboard` row in Needs you
 * now, because that diver already had a row there with the fix on it, and the
 * card's sentence told the same person a second way. The departure log's door
 * is not here: a live card is the day's briefing, and the log is offered on
 * the departure's Details tab and on the settled card once it is back (ADR
 * 20260804-incident-export-owner-gate, amendment 2026-10-07).
 *
 * A Server Component, so it takes the translator rather than a copy object.
 */

/**
 * A title cut before its last word: everything up to and including the last
 * space, then the last word. The last word rides with the title's chevron as
 * one unbreakable unit (K-464); a one-word title is all last word.
 */
function lastWordApart(title: string): [head: string, last: string] {
  const match = title.match(/^([\s\S]*\s)?(\S+)\s*$/);
  if (!match?.[2]) return ["", title];
  return [match[1] ?? "", match[2]];
}

export function DayStation({
  station,
  shopSlug,
  locale,
  timeZone,
  currency,
  crewed = false,
  t,
}: {
  station: DayStationData;
  shopSlug: string;
  locale: string;
  timeZone: string;
  currency: string;
  /** The signed-in staffer crews this boat — the one badge a station may wear. */
  crewed?: boolean;
  t: StaffTranslator;
}) {
  const stage = station.stage ?? null;
  // The pill is the word the crew tapped, the manifest strip's own word (UX
  // review 2026-10-10, item 1); where and since when ride beside it.
  const stageSince = stage
    ? stage.siteName && (stage.stage === "underway" || stage.stage === "surface")
      ? t("shopHome.spine.stage.sinceAtSite", {
          site: stage.siteName,
          time: formatTime(stage.recordedAt, locale, timeZone),
        })
      : t("shopHome.spine.stage.since", { time: formatTime(stage.recordedAt, locale, timeZone) })
    : "";
  const blocked = Math.min(station.blocked, station.booked);
  const ready = station.booked - blocked;
  // The seats on sale, not the stated number (H-20261009-certificate-caps-seats, #2388).
  const open = Math.max(0, station.sellableCapacity - station.booked);
  // **The crew's names are the desktop's**: on a phone the card is the time,
  // the boat and the bar, and who is crewing is one tap away on the departure
  // (and on Schedule's Crew view). Their names ran the line onto a second row.
  const meta = [
    { text: station.siteName, phone: true },
    { text: station.boatName, phone: true },
    { text: station.crewNames.length > 0 ? station.crewNames.join(", ") : null, phone: false },
    {
      text:
        station.priceCents === null
          ? null
          : formatMoneyScanned(station.priceCents, currency, locale),
      phone: true,
    },
  ].filter((fact): fact is { text: string; phone: boolean } => Boolean(fact.text));
  const intentLine = staffDiveIntentLine(t, station.intents ?? [], locale);
  const hello = sayHelloSentences(t, locale, station.welcome ?? []).join(" ");
  const [titleHead, titleLast] = lastWordApart(station.title);
  const crewRollCallOpen =
    station.booked > 0 &&
    station.boarded === station.booked &&
    station.blocked === 0 &&
    !station.crewAccountedFor &&
    station.crewReason !== "crew_none_assigned";

  return (
    <SectionCard as="li" padding="lg">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* A real `<time>`: the list's claim is that these read in clock order. */}
        <time dateTime={station.startsAt.toISOString()} className={FIGURE_INLINE_CLASS}>
          {formatTime(station.startsAt, locale, timeZone)}
        </time>
        <span className="text-sm text-muted tabular-nums">
          {/* One range form across the app, the en-dash one the trip header
              and the public card print; "until" is kept for a boat that comes
              home the next day, where the dash would read as the same evening
              (third review, item 9). */}
          {t(
            calendarDateInTimezone(station.startsAt, timeZone) ===
              calendarDateInTimezone(station.endsAt, timeZone)
              ? "shopHome.spine.rangeEnd"
              : "shopHome.spine.until",
            { time: formatTime(station.endsAt, locale, timeZone) },
          )}
        </span>
        {stage ? (
          <>
            <Badge tone={STAGE_TONE[stage.stage]} toneMark={false}>
              {t(STAGE_WORD_KEYS[stage.stage])}
            </Badge>
            <span className="text-sm text-muted tabular-nums">{stageSince}</span>
          </>
        ) : null}
      </p>
      <h3 className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 ${ITEM_TITLE_CLASS}`}>
        <Link
          href={`/shop/${shopSlug}/trips/${station.tripId}`}
          className={`${tapTargetLinkClass} group/station -mx-2 rounded-lg px-2 transition-colors hover:bg-surface-sunken hover:no-underline`}
        >
          {/* One run of text, its chevron on the end of it (pixel-craft K-464). */}
          <span>
            {titleHead}
            <span className="whitespace-nowrap">
              {titleLast}
              <span className={INLINE_LINE_BOX}>
                <DiveDayIcon
                  name="chevron-right"
                  className="size-4 shrink-0 text-muted transition-transform group-hover/station:translate-x-0.5"
                />
              </span>
            </span>
          </span>
        </Link>
        {station.rehearsal ? <Badge>{t("trips.rehearsal.label")}</Badge> : null}
        {crewed ? <Badge tone="primary">{t("shopHome.spine.crewing")}</Badge> : null}
      </h3>
      {meta.length > 0 ? (
        <p className="mt-1 text-sm text-muted">
          {meta.map((fact, index) => {
            // A separator a phone would show at the head of its line (the
            // crew hidden in front of it) is a desktop separator.
            const firstOnPhone = fact.phone && !meta.slice(0, index).some((f) => f.phone);
            return (
              <span key={fact.text} className={fact.phone ? undefined : "max-sm:hidden"}>
                {index > 0 ? (
                  <span className={firstOnPhone ? "max-sm:hidden" : undefined}>{" · "}</span>
                ) : null}
                {fact.text}
              </span>
            );
          })}
        </p>
      ) : null}
      {/* What the divers said they came for is the briefing's colour, not the
          day's work: a desktop line, never a phone's third row of grey. */}
      {intentLine ? <p className="mt-1 text-sm text-muted max-sm:hidden">{intentLine}</p> : null}
      {/* **Who to say hello to** (fifth loop, item 10): a line on the card at
          both widths, never a Needs you row, because a greeting has no done
          state. The roster and manifest carry the same cue on the diver's row. */}
      {hello ? (
        <p className="mt-1 text-sm">
          <span className="font-medium">{t("shopHome.spine.sayHello")}</span>
          <span aria-hidden="true" className="text-muted">
            {" · "}
          </span>
          <span className="text-muted">{hello}</span>
        </p>
      ) : null}

      {/* **The readiness bar.** Ready, then blocked, then the open seats, as
          one bar the boat's capacity wide; the words under it are the
          accessible reading, so the bar itself is decoration. The arrival
          desk draws the same bar (`ReadinessBar`, #2100). */}
      <ReadinessBar
        className="mt-4"
        ready={ready}
        blocked={blocked}
        of={station.sellableCapacity}
      />
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
        <span>{t("shopHome.spine.readyCount", { ready, booked: station.booked })}</span>
        {blocked > 0 ? (
          <span className="font-medium text-danger">
            {t("shopHome.spine.blockedCount", { count: blocked })}
          </span>
        ) : null}
        <span className="text-muted">
          {open === 0 ? t("shopHome.spine.full") : t("shopHome.spine.seatsOpen", { count: open })}
        </span>
      </p>

      {crewRollCallOpen ? (
        <p className="mt-3 text-sm font-medium text-warning">
          {t("shopHome.spine.crewRollCallOpen")}
        </p>
      ) : null}

      {/* **The crew's door to the roll call** (UX review 2026-10-13, item 17).
          The title goes to Divers, the desk's tab; a captain at the rail wants
          the manifest, which was the title, then the Boat tab, then a scroll.
          Only on a card the reader crews: for everyone else Divers is right. */}
      {crewed ? (
        <Link
          href={shopPath(shopSlug, "trips", station.tripId, "manifest")}
          className={buttonClass({ variant: "secondary", className: "mt-4 w-full sm:w-auto" })}
        >
          {t("shopHome.spine.openBoat")}
        </Link>
      ) : null}
    </SectionCard>
  );
}
