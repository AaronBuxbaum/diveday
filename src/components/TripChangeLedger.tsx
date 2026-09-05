import { SectionCard } from "@/components/ui/card";
import { FactSource } from "@/components/ui/FactSource";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { DIVER_FACT_SOURCE_KEYS } from "@/i18n/fact-source-labels";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { factSourceFromChangeEvent } from "@/lib/fact-source";
import { formatDateTimeTz } from "@/lib/format";

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

function changeText(
  event: TripChangeEvent,
  t: DiverTranslator,
  revealArrivalDetails: boolean,
): string {
  if (event.kind === "meeting_point") {
    const before = event.beforeValue ?? {};
    const meetingPointChanged =
      before.meetingPointLabel !== event.afterValue.meetingPointLabel ||
      before.meetingPointAddress !== event.afterValue.meetingPointAddress;
    const guidanceChanged = ARRIVAL_GUIDANCE_FIELDS.some(
      (field) => before[field] !== event.afterValue[field],
    );
    const photoChanged = before.arrivalPhotoUrl !== event.afterValue.arrivalPhotoUrl;

    if (!revealArrivalDetails) {
      return (
        [
          meetingPointChanged ? t("trip.changeMeetingPointUpdated") : null,
          guidanceChanged ? t("trip.changeArrivalGuidance") : null,
          photoChanged ? t("trip.changeArrivalPhoto") : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · ") || t("trip.changeMeetingPointUpdated")
      );
    }

    const label = valueText(event.afterValue.meetingPointLabel) ?? t("trip.arrivalShopDefault");
    const address = valueText(event.afterValue.meetingPointAddress);
    const meetingPoint = address
      ? t("trip.changeMeetingPointWithAddress", { label, address })
      : t("trip.changeMeetingPoint", { label });
    return (
      [
        meetingPointChanged ? meetingPoint : null,
        guidanceChanged ? t("trip.changeArrivalGuidance") : null,
        photoChanged ? t("trip.changeArrivalPhoto") : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ") || meetingPoint
    );
  }
  const summary = valueText(event.afterValue.conditionsSummary);
  return summary ? t("trip.changeConditionsWithSummary", { summary }) : t("trip.changeConditions");
}

/** A public, chronological ledger of material plan changes; no private actor data is shown. */
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
  if (events.length === 0) return null;
  const t = diverTranslator(locale);
  return (
    <SectionCard
      title={t("trip.changeLedgerHeading")}
      description={t("trip.changeLedgerBody")}
      className={className}
    >
      <ol className="flex flex-col gap-4">
        {events.map((event) => (
          <li key={event.id} className="border-s-2 border-border ps-4">
            <p className="text-sm font-medium">{changeText(event, t, revealArrivalDetails)}</p>
            {/* Where this entry came from, in the app's one provenance grammar
                (ADR 20260904-reef-all-the-way-down, Budget rule 5). The time is
                built by `formatDateTimeTz` in the shop's own zone rather than by
                a bare `toLocaleString`, whose default field set carries seconds
                (issue #799). */}
            <FactSource
              className="mt-1"
              kind={factSourceFromChangeEvent(event.source)}
              label={t(DIVER_FACT_SOURCE_KEYS[factSourceFromChangeEvent(event.source)])}
              at={formatDateTimeTz(event.occurredAt, locale, timeZone)}
            />
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
