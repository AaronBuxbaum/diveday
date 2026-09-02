import Link from "next/link";
import { SiteMark } from "@/components/illustration/SiteMark";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { FIGURE_CLASS, FIGURE_DIAL_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatTime } from "@/lib/format";
import type { AboardBlockerKind } from "@/lib/readiness";
import { siteMarkFor, siteMarkGroundFor } from "@/lib/site-mark";
import type { DayStation as DayStationData } from "@/lib/today";
import { StationSettles } from "./StationSettles";

/**
 * One station on the shop home's day spine — a departure, drawn at the time it
 * sails, with its work hanging beneath it.
 *
 * **ADR 20260827-clearwater-surface-language, decision 4.** The rule this file
 * must not drift from is principle 9's, applied at page scale: *a departure's
 * facts are said once, here, and never again by a row underneath.* The board
 * this replaced rendered one bordered card per boat and then repeated that
 * boat's title on every queue row hanging off it — twelve boxes in which one
 * departure's name appeared eight times. The station header owns the time, the
 * title, the site, the hull, the crew, the price and the head count; every row
 * below leads with the person or the chore and says nothing about the boat.
 *
 * Two sentences survive from the departure card, and only two, because neither
 * is a job anybody taps here and both describe a checkpoint rather than a fix:
 * a blocked diver who is **already aboard** (issue #791 — one line per kind,
 * never one reason spread over a whole count) and a full boat whose **crew**
 * roll call is still open (issue #789). The card's celebration does not
 * survive: "Everyone's aboard" was coral, and this ADR's coral table gives the
 * home exactly one morning moment — the all-clear line — which the spine
 * renders once, above the first station, or not at all.
 *
 * A Server Component, so it takes the translator rather than a copy object:
 * a station's counts are per-boat, and pre-resolving four plurals per
 * departure at the call site is how a plural ends up wired to the wrong count.
 */

/** What one aboard group is blocked on, in words. */
function aboardReasonKey(kind: AboardBlockerKind) {
  if (kind === "medical") return "shopHome.spine.aboardReasonMedical" as const;
  if (kind === "unknown") return "shopHome.spine.aboardReasonUnknown" as const;
  if (kind === "certification") return "shopHome.spine.aboardReasonCertification" as const;
  return "shopHome.spine.aboardReasonPayment" as const;
}

export function DayStation({
  station,
  shopSlug,
  locale,
  timeZone,
  currency,
  crewed = false,
  canOpenLog = false,
  next = false,
  t,
  children,
}: {
  station: DayStationData;
  shopSlug: string;
  locale: string;
  timeZone: string;
  currency: string;
  /** The signed-in staffer crews this boat — the one badge a station may wear. */
  crewed?: boolean;
  /**
   * `canPersonExportIncidentRecord`; the log door is simply absent for
   * everyone else (ADR 20260804-incident-export-owner-gate, decision 3 — hide,
   * don't explain).
   */
  canOpenLog?: boolean;
  /**
   * The next boat out — the one station whose site mark carries the surface's
   * one coral detail (the system sheet's budget: "one drawn creature's single
   * warm detail"). Every other mark on the spine is drawn in the line alone.
   */
  next?: boolean;
  t: StaffTranslator;
  /** This station's work rows, already composed by the spine. */
  children?: React.ReactNode;
}) {
  const open = Math.max(0, station.capacity - station.booked);
  const filled =
    station.capacity > 0 ? Math.min(100, Math.round((station.booked / station.capacity) * 100)) : 0;
  // The meta line: everything true of this departure that is not its time, its
  // title or its head count, joined by the one separator the language uses. A
  // fact the shop has not given the trip simply does not appear — a shore dive
  // has no hull, and a shop that prices at the counter has no price.
  const meta = [
    station.siteName,
    station.boatName,
    station.crewNames.length > 0 ? station.crewNames.join(", ") : null,
    station.priceCents === null ? null : formatMoneyCents(station.priceCents, currency, locale),
  ].filter((fact): fact is string => Boolean(fact));
  // The whole readiness fact, not the split counts: when every blocked diver on
  // a boat is marked `not_boarded` both split counts are zero, and a station
  // that went quiet there would be affirming the opposite of its own numbers.
  const crewRollCallOpen =
    station.booked > 0 &&
    station.boarded === station.booked &&
    station.blocked === 0 &&
    !station.crewAccountedFor &&
    station.crewReason !== "crew_none_assigned";

  return (
    <li className="grid grid-cols-1 gap-y-2 sm:grid-cols-[96px_112px_1fr] sm:gap-y-0">
      <div className="sm:pt-1 sm:text-end">
        {/* A real `<time>`: the spine's whole claim is that these read in clock
            order, and a machine-readable instant is what lets anything but a
            human check it. */}
        <time
          dateTime={station.startsAt.toISOString()}
          className={`block ${FIGURE_CLASS} leading-none tracking-tight`}
        >
          {formatTime(station.startsAt, locale, timeZone)}
        </time>
        <p className="mt-1.5 text-xs text-muted tabular-nums">
          {t("shopHome.spine.until", {
            time: formatTime(station.endsAt, locale, timeZone),
          })}
        </p>
      </div>
      {/* The rail, and on it the departure's drawn site mark — Reef's hand,
          first use (ADR 20260901-diveday-reimagined, slice 13f). Decorative:
          the order already says which boat is next and the time beside it is
          the fact; the drawing says what kind of water without a word. */}
      <div aria-hidden="true" className="relative hidden sm:block">
        <span className="absolute top-3.5 bottom-0 start-1/2 w-px -translate-x-1/2 bg-border" />
        <SiteMark
          mark={siteMarkFor({ siteName: station.siteName, isCourse: station.courseTitle !== null })}
          size="md"
          ground={siteMarkGroundFor(station.startsAt, timeZone)}
          coral={next}
          className="absolute top-0 start-1/2 -translate-x-1/2"
        />
      </div>
      <div className="pb-10">
        {/* Below `sm` the dial takes its own line under the title: beside it,
            a 64px glass plus its words left a boat's name three words wide
            on a 390px phone. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h3 className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${SECTION_TITLE_CLASS}`}>
              <Link
                href={`/shop/${shopSlug}/trips/${station.tripId}`}
                className={`${tapTargetLinkClass} group/station -mx-2 rounded-lg px-2 transition-colors hover:bg-surface-sunken hover:no-underline`}
              >
                {station.title}
                <DiveDayIcon
                  name="chevron-right"
                  className="size-4 shrink-0 text-muted transition-transform group-hover/station:translate-x-0.5"
                />
              </Link>
              {crewed ? <Badge tone="primary">{t("shopHome.spine.crewing")}</Badge> : null}
            </h3>
            {meta.length > 0 ? <p className="mt-1 text-sm text-muted">{meta.join(" · ")}</p> : null}
          </div>
          {/* The head count leads as a figure (decision 3), drawn as the
              board draws it: a dial whose water stands at booked-of-capacity
              in `shallows` — the token Reef minted for a fill that carries no
              fact — with the figure over the water and the words beside it.
              The roll call's dial (`HeadCount`) is the same anatomy on the
              one surface that counts heads; this one counts seats, which is
              why the words stay outside the glass at reading size and the
              water is never a state. */}
          <div className="flex shrink-0 items-center gap-3">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-full border border-border bg-surface-sunken">
              <div
                aria-hidden="true"
                data-station-water
                className="absolute inset-0 origin-bottom bg-shallows"
                style={{ transform: `scaleY(${filled / 100})` }}
              />
              <span
                className={`absolute inset-0 flex items-center justify-center ${FIGURE_DIAL_CLASS}`}
              >
                {station.booked}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-muted tabular-nums">
                {t("shopHome.spine.ofCapacity", { capacity: station.capacity })}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {open === 0
                  ? t("shopHome.spine.full")
                  : t("shopHome.spine.spotsOpen", { count: open })}
              </p>
            </div>
          </div>
        </div>

        {station.blockedAboardGroups.map((group) => (
          <p key={group.kind} className="mt-3 text-sm">
            {group.names.length === 1 && group.names[0]
              ? t("shopHome.spine.aboardNamed", {
                  name: group.names[0],
                  reason: t(aboardReasonKey(group.kind)),
                })
              : t("shopHome.spine.aboardCount", {
                  count: group.names.length,
                  reason: t(aboardReasonKey(group.kind)),
                })}
          </p>
        ))}
        {crewRollCallOpen ? (
          <p className="mt-3 text-sm font-medium text-warning">
            {t("shopHome.spine.crewRollCallOpen")}
          </p>
        ) : null}

        {/* **A departure that has not come home still has a log** — ADR
            20260804-incident-export-owner-gate's 2026-08-12 amendment says it
            in as many words: *offered on every departure row, not only the ones
            that are back, because the moment a shop most needs a departure's
            recorded facts is while the departure is still happening.* The
            document has always reported what is on record so far.

            6d moved the door onto the evening's station and left the live one
            without it, which put an owner whose boat is overdue exactly one
            place they cannot reach the record of who is on it. */}
        {canOpenLog ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/shop/${shopSlug}/trips/${station.tripId}/log`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("incidentExport.openLink")}
            </Link>
          </div>
        ) : null}

        {/* The rows, and the water that closes over them when the last one
            clears — Reef's first moment (ADR 20260901-diveday-reimagined,
            slice 13g). The sentence names this boat's own time: it is the
            station's answer, not the day's, which the summary line above the
            spine already gives. */}
        <StationSettles
          rowCount={station.rows.length}
          sentence={t("shopHome.spine.stationClear", {
            time: formatTime(station.startsAt, locale, timeZone),
          })}
        >
          {children}
        </StationSettles>
      </div>
    </li>
  );
}
