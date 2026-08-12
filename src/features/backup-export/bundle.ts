import type { AppDb } from "@/db/client";
import { loadShopExportBundleInput } from "@/db/export";
import { type FeedLabels, feedDocument, listFeedTrips } from "@/features/calendar-sync";
import {
  buildExportBundle,
  type ExportFile,
  fetchExportPhotos,
  zipExportBundle,
} from "@/lib/export";

/**
 * One shop's backup bundle: the same zip the staff export download produces
 * (README, every CSV, photos) with the shop-wide `trips.ics` riding along.
 *
 * Extracted from `run-backup.ts` when the DiveDay-side platform backup landed,
 * because the two runners must produce the *same artifact* — the restore
 * procedure in docs/engineering/backup-and-restore-runbook.md §4 is written
 * once and applied to whichever copy is at hand, so a file that appears in one
 * bundle and not the other makes that procedure wrong for one of them. Sharing
 * the assembly is what makes "the same bundle, two destinations" a fact rather
 * than an intention.
 *
 * Deliberately not exported from the module's `index.ts`: a caller outside this
 * feature that could assemble a bundle could also put one somewhere, and the
 * two places a bundle is allowed to go both live in here.
 */

export type BuildBackupBundleInput = {
  shopId: string;
  /** Translated words for the ride-along `trips.ics`, resolved against the shop's locale. */
  icsLabels: FeedLabels;
  /** Canonical app origin for the event links inside `trips.ics`. */
  origin: string;
  now: Date;
  /** Used for the photo fetches, so tests own all I/O. */
  fetchImpl?: typeof fetch;
};

export type BuildBackupBundleResult =
  | { ok: true; zip: Uint8Array; shopSlug: string }
  /** The shop row is gone — deleted between the caller's listing and here. */
  | { ok: false; reason: "shop_missing" };

/**
 * Throws only on a genuine bug: both callers wrap this in their own try/catch
 * and turn a throw into a recorded failure code, because a bundle that cannot
 * be assembled for one shop must never take a whole pass down.
 */
export async function buildBackupBundle(
  db: AppDb,
  input: BuildBackupBundleInput,
): Promise<BuildBackupBundleResult> {
  const bundleInput = await loadShopExportBundleInput(db, input.shopId, input.now);
  if (!bundleInput) return { ok: false, reason: "shop_missing" };

  // The .ics rides along: the shop-wide departures document, which by
  // calendar-sync's own invariant never contains a diver.
  const trips = await listFeedTrips(db, {
    shopId: input.shopId,
    personId: "",
    scope: "shop_trips",
    now: input.now,
  });
  const ics = feedDocument({
    trips,
    origin: input.origin,
    shopSlug: bundleInput.shopSlug,
    labels: input.icsLabels,
    now: input.now,
  });

  const photos = await fetchExportPhotos(bundleInput.photoUrls, input.fetchImpl);
  const files: ExportFile[] = [
    ...buildExportBundle(bundleInput, input.now),
    { name: "trips.ics", content: ics },
    ...photos.map((photo) => ({ name: photo.path, content: photo.bytes })),
  ];

  return { ok: true, zip: zipExportBundle(files), shopSlug: bundleInput.shopSlug };
}
