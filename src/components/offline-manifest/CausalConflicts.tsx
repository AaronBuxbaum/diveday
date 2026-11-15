import { RollCallEvidencePanel } from "@/components/RollCallEvidencePanel";
import { buttonClass } from "@/components/ui/button";
import { offlineCausalContext } from "@/lib/roll-call-offline-causality";
import type { OfflineTripControls } from "./controls";
import { useDeckMutation } from "./DeckFlow";
import type { OfflineTripView } from "./trip-view";

export function OfflineCausalConflicts({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { t, locale } = controls;
  const deck = useDeckMutation();
  const departure = view.checkpoint === "departure";
  const subjects = [
    ...view.manifest.divers.map((row) => ({
      name: row.fullName,
      id: row.bookingId,
      subject: { bookingId: row.bookingId },
    })),
    ...view.manifest.crew.flatMap((row) =>
      row.id ? [{ name: row.fullName, id: row.id, subject: { crewPersonId: row.id } }] : [],
    ),
  ];
  return subjects.map((row) => {
    const context = offlineCausalContext(
      view.envelope.snapshot,
      view.envelope.events,
      row.subject,
      view.checkpoint,
    );
    if (!context.conflict) return null;
    const anonymous = context.observedEvidenceIds.some((id) => id.startsWith("legacy:"));
    return (
      <RollCallEvidencePanel
        key={row.id}
        checkpoint={view.checkpoint}
        context={context}
        locale={locale}
        timeZone={view.envelope.snapshot.shop.timezone}
        copy={{
          heading: t("manifest.conflicts.heading", { name: row.name }),
          unknownOrder: t("manifest.conflicts.unknownOrder"),
          unknownDay: t("manifest.conflicts.unknownDay"),
          statuses: {
            boarded: t("manifest.conflicts.aboard"),
            not_boarded: t(departure ? "manifest.conflicts.ashore" : "manifest.conflicts.missing"),
            cleared: t("manifest.conflicts.cleared"),
          },
        }}
      >
        {anonymous ? (
          <p>{t("manifest.conflicts.legacyReconnect")}</p>
        ) : (
          (["boarded", "not_boarded", "cleared"] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={buttonClass({ variant: "secondary" })}
              disabled={view.expired || controls.busyBooking === row.id}
              onClick={async () => {
                deck?.setBusy(true);
                try {
                  const result = await controls.record(row.subject, {
                    status,
                    reconcilesEvidence: true,
                  });
                  if (result === true || (typeof result === "object" && result.ok)) {
                    deck?.saved(
                      row.id,
                      status,
                      typeof result === "object" ? result : { pending: true },
                    );
                  }
                } finally {
                  deck?.setBusy(false);
                }
              }}
            >
              {t(
                status === "boarded"
                  ? "manifest.conflicts.confirmAboard"
                  : status === "cleared"
                    ? "manifest.conflicts.takeBack"
                    : departure
                      ? "manifest.conflicts.confirmAshore"
                      : "manifest.conflicts.confirmMissing",
              )}
            </button>
          ))
        )}
      </RollCallEvidencePanel>
    );
  });
}
