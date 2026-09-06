import Link from "next/link";
import { BoatDrift } from "@/components/illustration/BoatDrift";
import { SiteMark } from "@/components/illustration/SiteMark";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { tapTargetLinkClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FIGURE_CLASS, FIGURE_DIAL_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { staffDiveIntentLine } from "@/i18n/dive-intent-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatTime } from "@/lib/format";
import type { AboardBlockerKind } from "@/lib/readiness";
import { siteMarkFor, siteMarkGroundFor } from "@/lib/site-mark";
import type { DayStation as DayStationData } from "@/lib/today";
import { STAGE_WORD_KEYS, stageTone } from "@/lib/trip-stages";
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
 * **ADR 20260904-reef-all-the-way-down, decision 1 (slice 16a): the station is
 * a panel.** Reef drew each departure as a `SectionCard` with its site tile
 * leading the header, and the first slices shipped Reef's tokens into the
 * three-column rail grid that was already here — the gap the canvas measured
 * from the running app. So: one panel per departure on the warm bed, the tile
 * at 84×60 in front of the time, the dial at 76px with the capacity inside it
 * and the open count beside, and the departure log as a **quiet link** rather
 * than a secondary button — present on every live station, because the
 * 2026-08-12 amendment to ADR 20260804-incident-export-owner-gate says the
 * moment a shop most needs the record is while the boat is still out; what the
 * slice changes is its weight, never its presence. `DaySpine.test.tsx` pins
 * the panel, the tile, the dial and the door's weight.
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
  const stage = station.stage ?? null;
  // The crew's word, composed here rather than in the chip: "Out on Molasses
  // Reef" needs the site the crew was on when they said it, and a departure
  // with no plan gets the siteless word rather than an empty gap.
  const stageWord = stage
    ? stage.stage === "underway" && !stage.siteName
      ? t("shopHome.spine.stage.underwayNoSite")
      : t(STAGE_WORD_KEYS[stage.stage], { site: stage.siteName ?? "" })
    : "";
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
  // What the divers aboard came for, as one quiet counted line (D12/#1172 with
  // D23/#1183, issue #1386). Null on a departure nobody answered on — which is
  // most of them, and renders nothing rather than an empty heading.
  //
  // Deliberately no heading, no icon, no tone and no badge: it is an aggregate
  // that names nobody, it suggests a conversation and never a pairing, and it
  // is the crew's own reading of the morning rather than a job anybody taps.
  // Until now it rendered only inside the manifest's collapsed buddy panel, so
  // a shop could collect answers for weeks and meet them only by opening a fold
  // on a safety surface.
  const intentLine = staffDiveIntentLine(t, station.intents ?? [], locale);
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
    <SectionCard as="li" padding="lg">
      {/* The header: the drawn site tile leads (Reef's hand, slice 13f — the
          rail it used to float on is gone), then the time and the title, then
          the head count. Below `sm` the count wraps onto its own line under
          the title: a 76px glass plus its words left a boat's name three words
          wide on a 390px phone. */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        <SiteMark
          mark={siteMarkFor({ siteName: station.siteName, isCourse: station.courseTitle !== null })}
          size="md"
          ground={siteMarkGroundFor(station.startsAt, timeZone)}
          coral={next}
        />
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* A real `<time>`: the spine's whole claim is that these read in
                clock order, and a machine-readable instant is what lets
                anything but a human check it. */}
            <time
              dateTime={station.startsAt.toISOString()}
              className={`${FIGURE_CLASS} leading-none tracking-tight`}
            >
              {formatTime(station.startsAt, locale, timeZone)}
            </time>
            <span className="text-sm text-muted tabular-nums">
              {t("shopHome.spine.until", {
                time: formatTime(station.endsAt, locale, timeZone),
              })}
            </span>
            {/* **Where the boat is, in the crew's own word** — ADR
                20260904-reef-all-the-way-down, decision 2, Budget rule 4. It
                renders only where a crew has said something, never "Unknown",
                and `home` alone takes the roll call's success tone. The boat is
                drawn inside the chip and drifts in once when the word becomes
                Underway; `coral={false}` unconditionally, because the spine
                spends its one coral detail on the next boat's site mark. */}
            {stage ? (
              <BoatDrift stage={stage.stage}>
                <Badge tone={stageTone(stage.stage)} toneMark={false} tabularNums>
                  <SiteMark mark="boat" size="chip" ground="bare" coral={false} />
                  {t("shopHome.spine.stage.chip", {
                    stage: stageWord,
                    time: formatTime(stage.recordedAt, locale, timeZone),
                  })}
                </Badge>
              </BoatDrift>
            ) : null}
          </p>
          <h3
            className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 ${SECTION_TITLE_CLASS}`}
          >
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
          {intentLine ? <p className="mt-1 text-sm text-muted">{intentLine}</p> : null}
        </div>
        {/* The head count leads as a figure (decision 3), drawn as the board
            draws it: a dial whose water stands at booked-of-capacity in
            `shallows` — the token Reef minted for a fill that carries no
            fact — with the figure and the capacity over the water and the
            open count beside it. The roll call's dial (`HeadCount`) is the
            same anatomy on the one surface that counts heads; this one counts
            seats, and the water is never a state. */}
        <div className="flex shrink-0 items-center gap-4 max-sm:basis-full sm:flex-row-reverse">
          <div className="relative size-19 shrink-0 overflow-hidden rounded-full border border-border bg-surface-sunken">
            <div
              aria-hidden="true"
              data-station-water
              className="absolute inset-0 origin-bottom bg-shallows"
              style={{ transform: `scaleY(${filled / 100})` }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={FIGURE_DIAL_CLASS}>{station.booked}</span>
              <span className="text-[11px] font-semibold text-primary-hover tabular-nums">
                {t("shopHome.spine.ofCapacity", { capacity: station.capacity })}
              </span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1 sm:items-end">
            <p className="text-sm text-muted tabular-nums">
              {open === 0
                ? t("shopHome.spine.full")
                : t("shopHome.spine.spotsOpen", { count: open })}
            </p>
            {/* **A departure that has not come home still has a log** — ADR
                20260804-incident-export-owner-gate's 2026-08-12 amendment says
                it in as many words: *offered on every departure row, not only
                the ones that are back.* A quiet link, not a button: an owner's
                rare act was standing at button weight beside every boat every
                morning, and the panel is calmer with it at reading weight
                (slice 16a). Absent, never disabled, for everyone else. */}
            {canOpenLog ? (
              <Link
                href={`/shop/${shopSlug}/trips/${station.tripId}/log`}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("incidentExport.openLink")}
              </Link>
            ) : null}
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
    </SectionCard>
  );
}
