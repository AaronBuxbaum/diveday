import { formatDateTimeTz } from "@/lib/format";
import type { OfflineManifestPayload, OfflineRollCallEvent } from "@/lib/offline-manifests";
import type { OfflineTripControls } from "./controls";

export function ReviewRoster({
  current,
  manifest,
  event,
  controls,
}: {
  current: OfflineManifestPayload;
  manifest: OfflineManifestPayload["manifests"][number];
  event: OfflineRollCallEvent;
  controls: OfflineTripControls;
}) {
  const { t, locale } = controls;
  return (
    <div className="space-y-2">
      <p>
        {t("shared.offlineManifest.single.reviewCurrentTrip", {
          trip: manifest.trip.title,
          startsAt: formatDateTimeTz(
            new Date(manifest.trip.startsAt),
            locale,
            current.shop.timezone,
          ),
        })}
      </p>
      <p>
        {current.rollCallMeetingDay === undefined
          ? t("shared.offlineManifest.single.reviewCurrentDayUnknown")
          : t("shared.offlineManifest.single.reviewCurrentDay", {
              day: current.rollCallMeetingDay + 1,
            })}
      </p>
      <p className="font-semibold">{t("shared.offlineManifest.single.reviewCurrentRoster")}</p>
      <ul className="divide-y divide-border rounded-panel border border-border">
        {manifest.divers.map((diver) => (
          <li key={diver.bookingId} className="px-3 py-2">
            {diver.fullName} —{" "}
            {t(
              diver.rollCall?.state === "boarded"
                ? "shared.presence.boarded"
                : diver.rollCall?.state === "not_boarded"
                  ? event.checkpoint === "departure"
                    ? "shared.presence.notBoarded"
                    : "shared.offlineManifest.single.notBackAboardActive"
                  : "shared.offlineManifest.single.reviewAwaiting",
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
