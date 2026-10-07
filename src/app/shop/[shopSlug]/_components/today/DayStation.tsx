import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { tapTargetLinkClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { INLINE_LINE_BOX } from "@/components/ui/StatusMark";
import { FIGURE_INLINE_CLASS, ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { staffDiveIntentLine } from "@/i18n/dive-intent-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatTime } from "@/lib/format";
import type { DayStation as DayStationData } from "@/lib/today";
import type { TripPhase } from "@/lib/trip-phase";
import { STAGE_WORD_KEYS } from "@/lib/trip-stages";

/**
 * One departure on Today — ADR 20261001-logbook, decision 4, which supersedes
 * the station panel that ADR 20260904-reef-all-the-way-down's slice 16a drew
 * here (the site tile, the water dial, the rows inside the panel).
 *
 * A card that answers three questions at a glance: when it leaves, where it is
 * in its day (the stage pill, the same Prep, Check-in, Aboard, Back the
 * departure's own stepper draws), and how ready its divers are (the bar). The
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

export const PHASE_TONE: Record<TripPhase, BadgeTone> = {
  prep: "neutral",
  checkin: "warning",
  aboard: "primary",
  back: "success",
};

const PHASE_KEYS = {
  prep: "trips.phases.prep",
  checkin: "trips.phases.checkin",
  aboard: "trips.phases.aboard",
  back: "trips.phases.back",
} as const satisfies Record<TripPhase, string>;

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
  const phase = station.phase ?? null;
  // The crew's own word, beside the pill: "Out on Molasses Reef since 9:14 AM"
  // says more than "Aboard" and is what the crew actually tapped.
  const stageWord = stage
    ? stage.stage === "underway" && !stage.siteName
      ? t("shopHome.spine.stage.underwayNoSite")
      : t(STAGE_WORD_KEYS[stage.stage], { site: stage.siteName ?? "" })
    : "";
  const blocked = Math.min(station.blocked, station.booked);
  const ready = station.booked - blocked;
  const open = Math.max(0, station.capacity - station.booked);
  const share = (count: number) =>
    station.capacity > 0 ? `${Math.min(100, (count / station.capacity) * 100)}%` : "0%";
  // **The crew's names are the desktop's**: on a phone the card is the time,
  // the boat and the bar, and who is crewing is one tap away on the departure
  // (and on Schedule's Crew view). Their names ran the line onto a second row.
  const meta = [
    { text: station.siteName, phone: true },
    { text: station.boatName, phone: true },
    { text: station.crewNames.length > 0 ? station.crewNames.join(", ") : null, phone: false },
    {
      text:
        station.priceCents === null ? null : formatMoneyCents(station.priceCents, currency, locale),
      phone: true,
    },
  ].filter((fact): fact is { text: string; phone: boolean } => Boolean(fact.text));
  const intentLine = staffDiveIntentLine(t, station.intents ?? [], locale);
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
          {t("shopHome.spine.until", { time: formatTime(station.endsAt, locale, timeZone) })}
        </span>
        {phase ? (
          <Badge tone={PHASE_TONE[phase]} toneMark={false}>
            {t(PHASE_KEYS[phase])}
          </Badge>
        ) : null}
        {stage ? (
          <span className="text-sm text-muted tabular-nums">
            {t("shopHome.spine.stage.chip", {
              stage: stageWord,
              time: formatTime(stage.recordedAt, locale, timeZone),
            })}
          </span>
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

      {/* **The readiness bar.** Ready, then blocked, then the open seats, as
          one bar the boat's capacity wide; the words under it are the
          accessible reading, so the bar itself is decoration. */}
      <div
        aria-hidden="true"
        data-readiness-bar
        className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-sunken"
      >
        <span className="bg-success" style={{ width: share(ready) }} />
        <span className="bg-danger" style={{ width: share(blocked) }} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
        <span>{t("shopHome.spine.readyCount", { ready, booked: station.booked })}</span>
        {blocked > 0 ? (
          <span className="font-medium text-danger">
            {t("shopHome.spine.blockedCount", { count: blocked })}
          </span>
        ) : null}
        <span className="text-muted">
          {open === 0 ? t("shopHome.spine.full") : t("shopHome.spine.spotsOpen", { count: open })}
        </span>
      </p>

      {crewRollCallOpen ? (
        <p className="mt-3 text-sm font-medium text-warning">
          {t("shopHome.spine.crewRollCallOpen")}
        </p>
      ) : null}
    </SectionCard>
  );
}
