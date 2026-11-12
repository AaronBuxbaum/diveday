import {
  type RollCallAction,
  RollCallButton,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { RollCallEvidencePanel } from "@/components/RollCallEvidencePanel";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";

export function LiveRollCallConflicts({
  manifest,
  actions,
  t,
  locale,
  timeZone,
}: {
  manifest: TripManifest;
  actions: { rollCall: RollCallAction; crewRollCall: RollCallAction };
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  const departure = manifest.checkpoint === "departure";
  const subjects = [
    ...manifest.divers.map((row) => ({
      id: row.bookingId,
      name: row.fullName,
      field: "bookingId" as const,
      context: row.rollCallContext,
      action: actions.rollCall,
    })),
    ...manifest.crew.map((row) => ({
      id: row.id,
      name: row.fullName,
      field: "personId" as const,
      context: row.rollCallContext,
      action: actions.crewRollCall,
    })),
  ];
  return subjects.map((row) =>
    row.context?.conflict ? (
      <RollCallEvidencePanel
        key={`${row.field}:${row.id}`}
        context={row.context}
        locale={locale}
        timeZone={timeZone}
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
        {(["boarded", "not_boarded", "cleared"] as const).map((status) => (
          <RollCallButton
            key={status}
            subject={{ field: row.field, id: row.id }}
            action={row.action}
            status={status}
            reconcilesEvidence
            label={t(
              status === "boarded"
                ? "manifest.conflicts.confirmAboard"
                : status === "cleared"
                  ? "manifest.conflicts.takeBack"
                  : departure
                    ? "manifest.conflicts.confirmAshore"
                    : "manifest.conflicts.confirmMissing",
            )}
            pendingLabel={t("words.busy.saving")}
            className={buttonClass({ variant: "secondary" })}
            copy={{
              errorRefusal: t("trips.rollCall.errorRefusal"),
              blockedMessage: t("trips.rollCall.errorRefusal"),
            }}
          />
        ))}
      </RollCallEvidencePanel>
    ) : null,
  );
}
