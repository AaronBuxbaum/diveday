import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatTime } from "@/lib/format";
import type { AboardBlockerKind } from "@/lib/readiness";
import type { DayStation as DayStationData } from "@/lib/today";

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
    <li className="grid grid-cols-1 gap-y-2 sm:grid-cols-[96px_40px_1fr] sm:gap-y-0">
      <div className="sm:pt-1 sm:text-end">
        {/* A real `<time>`: the spine's whole claim is that these read in clock
            order, and a machine-readable instant is what lets anything but a
            human check it. */}
        <time
          dateTime={station.startsAt.toISOString()}
          className="block text-2xl leading-none font-bold tracking-tight tabular-nums"
        >
          {formatTime(station.startsAt, locale, timeZone)}
        </time>
        <p className="mt-1.5 text-xs text-muted tabular-nums">
          {t("shopHome.spine.until", {
            time: formatTime(station.endsAt, locale, timeZone),
          })}
        </p>
      </div>
      {/* The rail. Decorative: the order already says which boat is next and
          the time beside it is the fact. */}
      <div aria-hidden="true" className="relative hidden sm:block">
        <span className="absolute top-3.5 bottom-0 start-1/2 w-px -translate-x-1/2 bg-border" />
        <span className="absolute top-1.5 start-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-primary bg-surface" />
      </div>
      <div className="pb-10">
        <div className="flex items-start justify-between gap-4 sm:gap-6">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold tracking-tight">
              <Link
                href={`/shop/${shopSlug}/trips/${station.tripId}`}
                className="group/station inline-flex items-center gap-1.5 hover:underline"
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
          {/* The head count leads as a figure, not as another line of small
              muted text (decision 3). */}
          <div className="shrink-0 text-end">
            <p className="text-xl leading-none font-bold tabular-nums">
              {station.booked}
              <span className="ms-1 text-sm font-semibold text-muted">
                {t("shopHome.spine.ofCapacity", { capacity: station.capacity })}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {open === 0
                ? t("shopHome.spine.full")
                : t("shopHome.spine.spotsOpen", { count: open })}
            </p>
          </div>
        </div>
        {/* A quiet meter, drawn as opacity on the fill rather than as a new
            token (the ADR ships no new tokens). The counts above are the
            statement; this is only their shape. */}
        <div aria-hidden="true" className="mt-3 h-1 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-muted opacity-30"
            style={{ width: `${filled}%` }}
          />
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

        {children}
      </div>
    </li>
  );
}
