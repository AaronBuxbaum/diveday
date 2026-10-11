import type { ReactNode } from "react";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";

/**
 * Before the store has been read — every server render included — the shell
 * says what is actually true and nothing more (`useSavedManifest`'s
 * `storeRead`).
 */
export function OfflineOpeningScreen({
  t,
  message,
}: {
  t: OfflineManifestTranslator;
  message: string;
}) {
  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <ShopPageHeader
        eyebrow={t("shared.offlineManifest.single.eyebrow")}
        title={t("shared.offlineManifest.openingHeading")}
        meta={
          <p className="text-muted" role="status" aria-live="polite">
            {message}
          </p>
        }
      />
    </main>
  );
}

/**
 * A `?trip=` with no saved copy: never saved here, or taken away by the
 * cross-shop purge, which this names rather than claiming nothing was saved.
 */
export function OfflineNoSavedTrip({
  t,
  message,
  removedForOtherShop,
  discardNotice,
}: {
  t: OfflineManifestTranslator;
  message: string;
  removedForOtherShop: boolean | null;
  discardNotice: ReactNode;
}) {
  // "Nothing saved on this phone yet" is a claim about this device having
  // never held a copy. When the cross-shop purge has just taken one away
  // mid-read (see the purge effect), that sentence is the one thing the
  // captain already knows is false — so this branch names the real cause
  // instead, and offers the only advice that is true for a record belonging
  // to someone else's shop. `removedForOtherShop === null` means nothing was
  // lost at all: a `?trip=` this device simply never saved, which is exactly
  // what the plain empty state is for.
  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      {discardNotice}
      <ShopPageHeader
        eyebrow={t("shared.offlineManifest.single.eyebrow")}
        title={
          removedForOtherShop
            ? t("shared.offlineManifest.single.removedOtherShopHeading")
            : t("shared.offlineManifest.single.emptyHeading")
        }
        meta={
          <p className="text-muted" role="status">
            {removedForOtherShop === null
              ? message
              : removedForOtherShop
                ? t("shared.offlineManifest.single.removedOtherShopMessage")
                : t("shared.offlineManifest.reconcile.noneForTrip")}
          </p>
        }
      />
      <div className="mt-6 rounded-panel border border-border bg-surface-sunken p-8 text-center sm:p-10">
        <div
          className="mx-auto grid size-12 place-items-center rounded-inset bg-surface text-2xl"
          aria-hidden="true"
        >
          <DiveDayIcon name="empty" className="size-5 text-primary" />
        </div>
        <p className="mx-auto mt-4 max-w-md text-muted">
          {removedForOtherShop
            ? t("shared.offlineManifest.single.removedOtherShopHint")
            : t("shared.offlineManifest.single.emptyHint")}
        </p>
      </div>
    </main>
  );
}
