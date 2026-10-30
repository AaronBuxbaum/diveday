import { siteRunsLine } from "@/components/TripArrivalCard";
import { SectionCard } from "@/components/ui/card";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { formatDateTimeTz } from "@/lib/format";
import { tripSiteNames } from "@/lib/trip-change-events";

function valueText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const ARRIVAL_GUIDANCE_FIELDS = [
  "arrivalLandmark",
  "arrivalParkingNote",
  "arrivalTransitNote",
  "arrivalLookFor",
  "arrivalFirstInteraction",
] as const;

/** The five facts the card can name; each is listed once, at its newest change. */
type FactKey = "meetingPoint" | "arrivalGuidance" | "arrivalPhoto" | "conditions" | "sites";

/**
 * The facts one event changed, each "{fact}: {new value}", or none. Unchanged
 * values are omitted so the ledger does not restate facts already on the page.
 */
function changedFacts(
  event: TripChangeEvent,
  t: DiverTranslator,
  locale: string,
  revealArrivalDetails: boolean,
): [FactKey, string][] {
  const before = event.beforeValue ?? {};
  if (event.kind === "meeting_point") {
    const meetingPointChanged =
      before.meetingPointLabel !== event.afterValue.meetingPointLabel ||
      before.meetingPointAddress !== event.afterValue.meetingPointAddress;
    const guidanceChanged = ARRIVAL_GUIDANCE_FIELDS.some(
      (field) => before[field] !== event.afterValue[field],
    );
    const photoChanged = before.arrivalPhotoUrl !== event.afterValue.arrivalPhotoUrl;
    // Public pages keep the event but never the exact place (arrival details
    // are for booked divers), so the fact is named without its value.
    const label = valueText(event.afterValue.meetingPointLabel) ?? t("trip.arrivalShopDefault");
    const address = valueText(event.afterValue.meetingPointAddress);
    const meetingPoint = !revealArrivalDetails
      ? t("trip.changeMeetingPointUpdated")
      : address
        ? t("trip.changeMeetingPointWithAddress", { label, address })
        : t("trip.changeMeetingPoint", { label });
    const facts: [FactKey, string][] = [];
    if (meetingPointChanged) facts.push(["meetingPoint", meetingPoint]);
    if (guidanceChanged) facts.push(["arrivalGuidance", t("trip.changeArrivalGuidance")]);
    if (photoChanged) facts.push(["arrivalPhoto", t("trip.changeArrivalPhoto")]);
    return facts;
  }
  if (event.kind === "site_change") {
    // Match the "Planned sites" row; site names are public on the trip page.
    const sites = tripSiteNames(event.afterValue);
    if (sites.join("\n") === tripSiteNames(before).join("\n")) return [];
    return [
      [
        "sites",
        sites.length > 0
          ? t("trip.changeSites", { sites: siteRunsLine(sites, locale, t) })
          : t("trip.changeSitesCleared"),
      ],
    ];
  }
  const summary = valueText(event.afterValue.conditionsSummary);
  const was = valueText(before.conditionsSummary);
  if (summary === was) return [];
  // Report a cleared note so readers do not rely on its previous warning.
  if (!summary) return was ? [["conditions", t("trip.changeConditionsCleared")]] : [];
  return [["conditions", t("trip.changeConditionsWithSummary", { summary })]];
}

/**
 * Show each changed trip fact once, at its newest value and time. Keep the
 * broad source (shop or crew) so an office edit is not attributed to the crew;
 * show no private actor data. Public pages may name a changed arrival fact but
 * never reveal its exact place. Render nothing when no fact changed.
 */
export function TripChangeLedger({
  events,
  locale,
  timeZone,
  revealArrivalDetails = true,
  className = "",
}: {
  events: readonly TripChangeEvent[];
  locale: string;
  timeZone: string;
  /** Public pages keep the event but omit exact arrival values. */
  revealArrivalDetails?: boolean;
  className?: string;
}) {
  const t = diverTranslator(locale);
  // Keep the newest event for each fact independently; a photo change must
  // not hide an earlier meeting-point change.
  const newest = new Map<
    FactKey,
    { text: string; occurredAt: Date; source: TripChangeEvent["source"]; id: string }
  >();
  for (const event of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    for (const [key, text] of changedFacts(event, t, locale, revealArrivalDetails)) {
      newest.set(key, {
        text,
        occurredAt: event.occurredAt,
        source: event.source,
        id: `${event.id}:${key}`,
      });
    }
  }
  const entries = [...newest.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  if (entries.length === 0) return null;
  return (
    <SectionCard title={t("trip.changeLedgerHeading")} className={className}>
      <ol className="flex flex-col gap-4">
        {entries.map(({ text, occurredAt, source, id }) => (
          <li key={id}>
            <p className="text-sm font-medium">{text}</p>
            {/* In the shop's own zone, named (`formatDateTimeTz`), never a
                bare `toLocaleString` with its seconds (issue #799). */}
            <p className="mt-1 text-sm text-muted">
              {t(source === "crew" ? "trip.changedByCrew" : "trip.changedByShop", {
                when: formatDateTimeTz(occurredAt, locale, timeZone),
              })}
            </p>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
