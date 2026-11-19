import { OFFLINE_NOTICE_CLASS } from "@/components/offline-notice";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";

/** A readable pending queue is not proof of delivery or of who is aboard. */
export function PendingRollCallWarning({
  t,
  pending,
}: {
  t: OfflineManifestTranslator;
  pending: boolean;
}) {
  if (!pending) return null;
  return (
    <p
      className={`mb-4 ${OFFLINE_NOTICE_CLASS} border-warning/40 bg-warning/10 text-pretty`}
      role="status"
      aria-live="polite"
    >
      {t("shared.offlineManifest.reconcile.pendingExpiryWarning")}
    </p>
  );
}
