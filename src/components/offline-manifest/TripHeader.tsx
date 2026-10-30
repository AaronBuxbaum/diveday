import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { OfflineFreshnessPill } from "@/components/OfflineFreshnessPill";
import { OFFLINE_NOTICE_CLASS } from "@/components/offline-notice";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { useOnline } from "@/components/use-online";
import type { OfflineTripControls } from "./controls";
import { offlineHeaderChip } from "./header-chip";
import { StatusMessage } from "./StatusMessage";
import type { OfflineTripView } from "./trip-view";

/**
 * The saved copy's header: which departure, when, how fresh, and what is
 * still queued on this device.
 */
export function OfflineTripHeader({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { manifest, expired, freshness, pending, rejected, savedAtHeader } = view;
  const { t, message, servedWithoutAnswer, liveOffer } = controls;
  const chip = offlineHeaderChip({ online: useOnline(), servedWithoutAnswer, freshness });
  const noteLossVisible = [...view.envelope.events, ...view.envelope.checklistEvents].some(
    (event) =>
      event.noteDisposition === "discarded_erasure_cutoff" ||
      event.noteDisposition === "discarded_unverified_snapshot",
  );
  return (
    <div className="border-b border-border pb-6">
      <ShopPageHeader
        align="start"
        printActions
        eyebrow={t("shared.offlineManifest.single.eyebrow")}
        title={manifest.trip.title}
        description={t("shared.offlineManifest.single.savedAt", { when: savedAtHeader })}
        actions={
          // One chip (B51): see `offlineHeaderChip`.
          chip.kind === "connectivity" ? (
            <ConnectivityStatus
              offlineLabel={t("shared.connectivity.offlineWithCopy")}
              unanswered={
                servedWithoutAnswer
                  ? {
                      label: t("shared.connectivity.unansweredWithCopy"),
                      title: t("shared.connectivity.unansweredTitle"),
                    }
                  : undefined
              }
              copy={{
                online: t("shared.connectivity.online"),
                onlineTitle: t("shared.connectivity.onlineTitle"),
                offlineTitle: t("shared.connectivity.offlineTitle"),
              }}
            />
          ) : (
            <span role="status" aria-live="polite">
              <OfflineFreshnessPill freshness={chip.freshness}>
                {chip.online
                  ? t(
                      noteLossVisible
                        ? "shared.offlineManifest.freshnessPill.currentOnlineWithNoteLoss"
                        : "shared.offlineManifest.freshnessPill.currentOnline",
                    )
                  : t(`shared.offlineManifest.freshnessPill.${chip.freshness}`)}
              </OfflineFreshnessPill>
            </span>
          )
        }
      />
      {expired ? (
        <p
          className={`mt-4 ${OFFLINE_NOTICE_CLASS} border-danger/40 bg-danger-tint font-semibold text-danger`}
        >
          {t("shared.offlineManifest.single.expiredBanner")}
        </p>
      ) : (
        <p className={`mt-4 ${OFFLINE_NOTICE_CLASS} border-warning/40 bg-warning/10 text-pretty`}>
          {servedWithoutAnswer
            ? t("shared.offlineManifest.single.unansweredBanner")
            : t(
                noteLossVisible
                  ? "shared.offlineManifest.single.freshnessBannerWithNoteLoss"
                  : "shared.offlineManifest.single.freshnessBanner",
                { freshnessNote: t(`shared.offlineManifest.freshnessCopy.${freshness}`) },
              )}
        </p>
      )}
      {servedWithoutAnswer && liveOffer ? (
        <div className="mt-4 flex flex-wrap items-center gap-3" role="status" aria-live="polite">
          <p className="text-sm font-medium">{t("shared.offlineManifest.single.liveAnswering")}</p>
          <a href={liveOffer} className={buttonClass({ size: "boat" })}>
            {t("shared.offlineManifest.single.openLiveManifest")}
          </a>
        </div>
      ) : null}
      <p className="mt-3 text-sm font-medium" role="status" aria-live="polite">
        <StatusMessage message={message} />
      </p>
      {noteLossVisible && pending === 0 && rejected === 0 ? null : (
        <p className="mt-1 text-sm text-muted">
          {t("shared.offlineManifest.single.pendingRejectedCounts", { pending, rejected })}
        </p>
      )}
    </div>
  );
}
