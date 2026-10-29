import type { ReactNode } from "react";
import { OFFLINE_NOTICE_CLASS } from "@/components/offline-notice";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { StatusMessage } from "./StatusMessage";

/**
 * The page's shape with no words in it: the eyebrow and title the view opens
 * with, then a few hairline rows where the saved copies land. In `boat-mode`
 * like the view, so the page does not change colour when the real one
 * arrives. It is the segment's `loading.tsx`, the static shell's `<Suspense>`
 * fallback, and what the view draws until it knows the device's language
 * (`OfflineManifestView`).
 */
export function OfflineManifestSkeleton() {
  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-t border-border py-4 last:border-b">
              <div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />
              <div className="mt-2 h-4 w-40 max-w-full rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

/**
 * Before the store has been read, the shell says what is actually true and
 * nothing more (`useSavedManifest`'s `storeRead`).
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
            <StatusMessage message={message} />
          </p>
        }
      />
    </main>
  );
}

/** A server-detected shop switch: retain encrypted events, but never leave the old roster actionable. */
export function OfflineTenantVerificationScreen({
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
        title={t("shared.offlineManifest.single.tenantChangedHeading")}
        meta={
          <p className="text-muted" role="status" aria-live="polite">
            <StatusMessage message={message} />
          </p>
        }
      />
    </main>
  );
}

/** A shared device has no safe shop identity while its lookup is unanswered. */
export function OfflineTenantUnverifiedScreen({
  t,
  message,
  referenceMessage,
  readFailed,
}: {
  t: OfflineManifestTranslator;
  message: string;
  referenceMessage: string;
  readFailed: boolean;
}) {
  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <ShopPageHeader
        eyebrow={t("shared.offlineManifest.single.eyebrow")}
        title={t("shared.offlineManifest.single.identityUnverifiedHeading")}
        meta={
          <p className="text-muted" role="status" aria-live="polite">
            {t("shared.offlineManifest.reconcile.tenantUnverified")}
          </p>
        }
      />
      {readFailed ? (
        <p className="mt-4 text-muted" role="status">
          {t("shared.offlineManifest.reconcile.singleLoadError")}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 text-muted" role="status" aria-live="polite">
          <StatusMessage message={message} />
        </p>
      ) : null}
      {referenceMessage ? (
        <p className="mt-4 rounded-inset border border-warning/40 bg-warning/10 px-4 py-3 text-pretty">
          <StatusMessage message={referenceMessage} />
        </p>
      ) : null}
    </main>
  );
}

/**
 * A `?trip=` with no saved copy on screen: never saved here, taken away by the
 * cross-shop purge, or held but unreadable. The last two are named rather than
 * claiming nothing was saved.
 */
export function OfflineNoSavedTrip({
  t,
  message,
  removedForOtherShop,
  readFailed,
  discardNotice,
  foreignPendingChanges = false,
}: {
  t: OfflineManifestTranslator;
  message: string;
  removedForOtherShop: boolean | null;
  /** The store read threw (#2637): a copy may be there and failed to open. */
  readFailed: boolean;
  discardNotice: ReactNode;
  /** A tenant-neutral recovery path for pending copies retained from another shop. */
  foreignPendingChanges?: boolean;
}) {
  // "Nothing saved on this phone yet" is a claim about this device having
  // never held a copy. When the cross-shop purge has just taken one away
  // mid-read (see the purge effect), that sentence is the one thing the
  // captain already knows is false — so this branch names the real cause
  // instead, and offers the only advice that is true for a record belonging
  // to someone else's shop. `removedForOtherShop === null` means nothing was
  // lost at all: a `?trip=` this device simply never saved, which is exactly
  // what the plain empty state is for.
  //
  // A read that threw is the same mistake the other way round (#2637): the
  // copy may be on this phone and only failed to open, and a captain who reads
  // "nothing saved" stops looking for it. So it gets its own heading and the
  // two things worth trying, and the error line beneath stays.
  const unreadable = readFailed && !removedForOtherShop;
  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      {discardNotice}
      {foreignPendingChanges ? (
        <p
          className={`${OFFLINE_NOTICE_CLASS} mb-4 border-warning/40 bg-warning/10 text-pretty`}
          role="status"
          aria-live="polite"
        >
          {t("shared.offlineManifest.reconcile.foreignPending")}
        </p>
      ) : null}
      <ShopPageHeader
        eyebrow={t("shared.offlineManifest.single.eyebrow")}
        title={
          removedForOtherShop
            ? t("shared.offlineManifest.single.removedOtherShopHeading")
            : unreadable
              ? t("shared.offlineManifest.single.readFailedHeading")
              : t("shared.offlineManifest.single.emptyHeading")
        }
        meta={
          <p className="text-muted" role="status">
            {removedForOtherShop === null || unreadable ? (
              <StatusMessage message={message} />
            ) : removedForOtherShop ? (
              t("shared.offlineManifest.single.removedOtherShopMessage")
            ) : (
              t("shared.offlineManifest.reconcile.noneForTrip")
            )}
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
            : unreadable
              ? t("shared.offlineManifest.single.readFailedHint")
              : t("shared.offlineManifest.single.emptyHint")}
        </p>
      </div>
    </main>
  );
}
