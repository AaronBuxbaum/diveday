import { checkpointGapLine } from "@/components/checkpoint-gap-words";
import { DecompressionReminder } from "@/components/DecompressionReminder";
import { MixedTrainingDepthWarning } from "@/components/MixedTrainingDepthWarning";
import { buttonClass } from "@/components/ui/button";
import { crewDives, needsDecompressionCardReminder } from "@/lib/decompression-reminder";
import { isHeldSeat } from "@/lib/held-seat";
import { physicalPeople } from "@/lib/manifest-person-counts";
import { rollCallCheckpointOrdinal } from "@/lib/manifests";
import { countParticipants, hasNonDivers, joinPassengerSplit } from "@/lib/participant-types";
import { mixedTrainingDepthAdvisory } from "@/lib/training-mark";
import type { OfflineTripControls } from "./controls";
import { StatusMessage } from "./StatusMessage";
import type { OfflineTripView } from "./trip-view";

export function OfflineDeckSafety({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { t } = controls;
  const { manifest } = view;
  const recount = physicalPeople(
    manifest.divers.filter((diver) => diver.recountRequired),
    manifest.crew.filter((member) => member.recountRequired),
  );
  const history = physicalPeople(
    manifest.divers.filter((diver) => diver.historicalReviewRequired),
    manifest.crew.filter((member) => member.historicalReviewRequired),
  );
  const gap = view.previousGaps.get(view.checkpoint);
  const missingGap = gap?.kind === "unmarked" && gap.missing > 0 ? gap : null;
  const decompression =
    view.isDeparture &&
    needsDecompressionCardReminder({
      exceedsNoDecoLimits: manifest.trip.exceedsNoDecoLimits,
      seats: manifest.divers.map((diver) => ({
        participantType: diver.participantType,
        released: Boolean(diver.notHere),
      })),
      divingCrew: crewDives(manifest.crew),
    });
  return (
    <>
      {recount > 0 ? (
        <p className="text-danger" role="status">
          {t("manifest.recountRequired", { count: recount })}{" "}
          {t("manifest.deck.recountOfflineGuidance")}
        </p>
      ) : null}
      {history > 0 ? (
        <p className="text-danger" role="status">
          {t("manifest.historicalReviewRequired", { count: history })}
        </p>
      ) : null}
      {view.overTotalPersons ? (
        <p
          className="mt-3 rounded-inset border border-danger bg-danger-tint px-4 py-3 text-base font-bold text-danger"
          role="status"
        >
          {t("manifest.headCountOverTotalPersonsAboard", view.overTotalPersons)}
        </p>
      ) : null}
      <MixedTrainingDepthWarning
        show={mixedTrainingDepthAdvisory(
          manifest.divers.flatMap((diver) =>
            !diver.identityWithheld && !isHeldSeat(diver) && diver.trainingDive
              ? [diver.trainingDive]
              : [],
          ),
        )}
        t={t}
      />
      {decompression ? <DecompressionReminder text={t("manifest.decompressionReminder")} /> : null}
      {missingGap ? (
        <p className="mt-3 text-base font-bold text-danger">
          {checkpointGapLine(t, missingGap)}{" "}
          <button
            type="button"
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
            onClick={() => controls.setCheckpoint(missingGap.checkpoint)}
          >
            {t("manifest.checkpointGap.back", {
              dive: rollCallCheckpointOrdinal(missingGap.checkpoint),
            })}
          </button>
        </p>
      ) : null}
    </>
  );
}

export function OfflineDeckReference({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { t } = controls;
  const types = countParticipants(
    view.manifest.divers.filter((_diver, index) => !view.offBoat[index]),
  );
  return (
    <>
      {hasNonDivers(types) ? (
        <p className="text-sm text-muted tabular-nums">
          {joinPassengerSplit(types, (type, count) =>
            type === "diver"
              ? t("manifest.passengerDivers", { count })
              : type === "snorkeler"
                ? t("manifest.passengerSnorkelers", { count })
                : t("manifest.passengerRiders", { count }),
          )}
        </p>
      ) : null}
      {view.anyBuddies ? (
        <p className="text-sm text-pretty text-muted">
          {t("shared.offlineManifest.single.buddyReadOnlyHere")}
        </p>
      ) : null}
    </>
  );
}

export function OfflineDeckDelivery({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { t } = controls;
  const pending =
    view.pending > 0
      ? t("shared.offlineManifest.reconcile.pendingWaiting", { count: view.pending })
      : null;
  return (
    <div className="space-y-1">
      {controls.servedWithoutAnswer || view.freshness !== "current" ? (
        <p>
          {controls.servedWithoutAnswer
            ? t("shared.connectivity.unansweredWithCopy")
            : t("manifest.deck.savedCopy")}
          {view.freshness !== "current" ? (
            <> · {t(`shared.offlineManifest.freshnessPill.${view.freshness}`)}</>
          ) : null}
        </p>
      ) : null}
      <p
        className={
          view.expired || view.freshness === "stale" ? "font-semibold text-danger" : "text-muted"
        }
      >
        {view.expired
          ? t("shared.offlineManifest.single.expiredBanner")
          : t("manifest.deck.copyCaveat")}
      </p>
      {pending ? <p>{pending}</p> : null}
      {controls.servedWithoutAnswer && controls.liveOffer ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">{t("shared.offlineManifest.single.liveAnswering")}</p>
          <a href={controls.liveOffer} className={buttonClass({ size: "boat" })}>
            {t("shared.offlineManifest.single.openLiveManifest")}
          </a>
        </div>
      ) : null}
      {view.rejected > 0 ? (
        <p className="font-semibold text-danger">
          {t("shared.offlineManifest.reconcile.pendingRejectedSingle", { count: view.rejected })}
        </p>
      ) : null}
      {controls.message &&
      controls.message !== t("shared.offlineManifest.single.record.saved") &&
      controls.message !== pending ? (
        <StatusMessage message={controls.message} />
      ) : null}
    </div>
  );
}
