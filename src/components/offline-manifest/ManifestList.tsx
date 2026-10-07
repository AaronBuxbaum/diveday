import type { ComponentProps, ReactNode } from "react";
import { freshnessInkClass, OfflineFreshnessPill } from "@/components/OfflineFreshnessPill";
import { OfflineShellVersionBanner } from "@/components/OfflineShellVersionBanner";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { sectionCardClass } from "@/components/ui/card";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { cachedFormatter } from "@/lib/intl-cache";
import {
  isOfflineManifestExpired,
  type OfflineManifestEnvelope,
  offlineManifestFreshness,
} from "@/lib/offline-manifests";
import { deviceLocale, relativeAge } from "./shared";

/**
 * **Every copy saved on this device**, the page `/offline-manifest` shows
 * with no `?trip=`: one row per departure, how fresh each is, and what is
 * still queued on it.
 */
export function OfflineManifestList({
  t,
  shellVersionCopy,
  list,
  message,
  discardNotice,
}: {
  t: OfflineManifestTranslator;
  shellVersionCopy: ComponentProps<typeof OfflineShellVersionBanner>["copy"];
  /** `null` until the store has been read. */
  list: OfflineManifestEnvelope[] | null;
  message: string;
  discardNotice: ReactNode;
}) {
  const savedTrips = list ?? [];
  // Derived once, for the header's count, the header's shop name and the rows
  // alike: all three must be answers about the same set of copies. A record
  // carrying no manifest renders no row, so it is dropped here rather than
  // downstream — counted, it would have the header report a copy needing a
  // refresh that a reader can find nowhere on the page.
  const savedRows = savedTrips.flatMap((saved) => {
    const tripManifest = saved.snapshot.manifests[0];
    if (!tripManifest) return [];
    return [
      {
        saved,
        tripManifest,
        freshness: offlineManifestFreshness(new Date(saved.snapshot.savedAt)),
        // An expired-but-kept-alive record (see loadOfflineManifest) is not a
        // boarding source even though it's still readable, so it keeps its
        // own distinct label rather than an age (the per-trip view already
        // says this plainly once opened).
        expired: isOfflineManifestExpired(saved.snapshot),
      },
    ];
  });
  const needRefreshCount = savedRows.filter(
    (row) => row.expired || row.freshness !== "current",
  ).length;
  // The shop belongs to the page, not to the row: this viewer is single-shop
  // by construction, because the shell purges the store when a different
  // shop signs in on the device. `null` is the window where that has not run
  // yet — genuinely offline, two shops' records side by side — and there the
  // boundary between them is the most important thing on screen, so the name
  // stays on each row and out of the header. Never a header naming one shop
  // over records belonging to another.
  const shopNames = new Set(savedRows.map((row) => row.saved.snapshot.shop.name));
  const oneShopName = shopNames.size === 1 ? [...shopNames][0] : null;
  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <OfflineShellVersionBanner copy={shellVersionCopy} />
      {discardNotice}
      <ShopPageHeader
        eyebrow={t("shared.offlineManifest.list.eyebrow")}
        title={
          savedTrips.length > 0
            ? t("shared.offlineManifest.list.headingWithTrips")
            : t("shared.offlineManifest.list.headingEmpty")
        }
        description={oneShopName ?? undefined}
        meta={
          <>
            <p className="text-muted" role="status" aria-live="polite">
              {message}
            </p>
            {/* Principle 2 wants a freshness state visible on a boat surface;
                principle 9 refuses to spend a badge on the state every row is
                normally in. Said once here, for the group, it is both: the
                reader is still told, and a pill below now only ever appears on
                a copy that needs them. */}
            {savedRows.length > 0 ? (
              <p className="mt-1 text-sm font-semibold">
                {needRefreshCount > 0
                  ? t("shared.offlineManifest.list.freshnessNeedRefresh", {
                      count: needRefreshCount,
                    })
                  : t("shared.offlineManifest.list.freshnessAllCurrent")}
              </p>
            ) : null}
          </>
        }
      />
      {savedTrips.length > 0 ? (
        <ul
          className={sectionCardClass({
            padding: "none",
            className: "mt-6 divide-y divide-border overflow-hidden",
          })}
        >
          {savedRows.map(
            ({ saved, tripManifest, freshness: savedFreshness, expired: savedExpired }) => {
              const dateTime = cachedFormatter("dt", Intl.DateTimeFormat, deviceLocale(), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: saved.snapshot.shop.timezone,
              });
              // The row fills the card, whose `overflow-hidden` cut the
              // outset ring on three sides: the ring goes inside, and the
              // first and last rows take the card's corners so the clip
              // cannot shave the ring's.
              return (
                <li
                  key={tripManifest.trip.id}
                  className="first:rounded-t-panel last:rounded-b-panel"
                >
                  <a
                    href={`/offline-manifest?trip=${tripManifest.trip.id}`}
                    className="flex min-h-14 flex-col gap-2 rounded-[inherit] p-4 transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:focus-ring-inset sm:flex-row sm:items-center sm:justify-between sm:p-5"
                  >
                    <div>
                      <p className={ITEM_TITLE_CLASS}>{tripManifest.trip.title}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {oneShopName ? null : `${saved.snapshot.shop.name} · `}
                        {dateTime.format(new Date(tripManifest.trip.startsAt))} ·{" "}
                        {t("shared.offlineManifest.list.diverCount", {
                          count: tripManifest.summary.totalDivers,
                        })}
                      </p>
                    </div>
                    {savedExpired ? (
                      <span className="inline-flex min-h-9 items-center self-start rounded-full border border-danger/30 bg-danger-tint px-3 py-1.5 text-sm font-bold text-danger">
                        {t("shared.offlineManifest.list.expiredViewOnly")}
                      </span>
                    ) : savedFreshness === "current" ? null : (
                      // Principle 4's carve-out: a copy that is no longer
                      // current names its age and what to do about it, never a
                      // tier word. Only these rows carry a pill at all now, so
                      // the one that appears is the one to look at.
                      <div className="flex shrink-0 flex-col items-start gap-1 self-start">
                        <OfflineFreshnessPill freshness={savedFreshness}>
                          {t("shared.offlineManifest.list.savedAgo", {
                            ago: relativeAge(new Date(saved.snapshot.savedAt)),
                          })}
                        </OfflineFreshnessPill>
                        <span
                          className={`text-sm font-semibold ${freshnessInkClass[savedFreshness]}`}
                        >
                          {t("shared.offlineManifest.list.refreshBeforeRelying")}
                        </span>
                      </div>
                    )}
                  </a>
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <div className="mt-6 rounded-panel border border-border bg-surface-sunken p-8 text-center sm:p-10">
          <div
            className="mx-auto grid size-12 place-items-center rounded-inset bg-surface text-2xl"
            aria-hidden="true"
          >
            <DiveDayIcon name="empty" className="size-5 text-primary" />
          </div>
          <p className="mx-auto mt-4 max-w-md text-muted">
            {t("shared.offlineManifest.list.emptyHint")}
          </p>
        </div>
      )}
    </main>
  );
}
