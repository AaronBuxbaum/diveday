import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { OfflineFreshnessPill } from "@/components/OfflineFreshnessPill";
import { OFFLINE_NOTICE_CLASS } from "@/components/offline-notice";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import type { OfflineTripControls } from "./controls";
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
  const { envelope, manifest, expired, freshness, pending, rejected, dateTime } = view;
  const { t, message, servedWithoutAnswer } = controls;
  const savedAt = dateTime.format(new Date(envelope.snapshot.savedAt));
  return (
    <div className="border-b border-border pb-6">
      <ShopPageHeader
        align="start"
        printActions
        eyebrow={t("shared.offlineManifest.single.eyebrow")}
        title={manifest.trip.title}
        description={t("shared.offlineManifest.single.savedAt", { when: savedAt })}
        actions={
          <>
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
            {/* How fresh a copy is answers "should I trust it?" for a copy the
              captain chose. One the worker chose because DiveDay was silent is
              not the live list however young it is, so it gets no "Fresh". */}
            {servedWithoutAnswer ? null : (
              <OfflineFreshnessPill freshness={freshness}>
                {t(`shared.offlineManifest.freshnessPill.${freshness}`)}
              </OfflineFreshnessPill>
            )}
          </>
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
            ? t("shared.offlineManifest.single.unansweredBanner", { when: savedAt })
            : t("shared.offlineManifest.single.freshnessBanner", {
                freshnessNote: t(`shared.offlineManifest.freshnessCopy.${freshness}`),
              })}
        </p>
      )}
      <p className="mt-3 text-sm font-medium" role="status" aria-live="polite">
        {message}
      </p>
      <p className="mt-1 text-sm text-muted">
        {t("shared.offlineManifest.single.pendingRejectedCounts", { pending, rejected })}
      </p>
    </div>
  );
}
