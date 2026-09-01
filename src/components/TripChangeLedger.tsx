import { SectionCard } from "@/components/ui/card";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
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
            <p className="mt-1 text-xs text-muted">
              {event.source === "crew" ? t("trip.changeSourceCrew") : t("trip.changeSourceShop")} ·{" "}
              {formatDateTimeTz(event.occurredAt, locale, timeZone)}
            </p>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
