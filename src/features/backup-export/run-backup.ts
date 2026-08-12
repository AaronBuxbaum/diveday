import type { AppDb } from "@/db/client";
import type { BackupDeliveryTrigger } from "@/db/schema";
import type { FeedLabels } from "@/features/calendar-sync";
import { nowDate } from "@/lib/clock";
import { buildBackupBundle } from "./bundle";
import {
  beginBackupDelivery,
  finishBackupDelivery,
  hasDeliveredScheduledBackup,
} from "./delivery-store";
import {
  type BackupSecretOptions,
  getShopBackupDestination,
  markShopBackupVerified,
  openBackupCredentials,
} from "./destination-store";
import { backupObjectKey, backupPeriodKey } from "./period";
import { type BackupUploadErrorCode, putS3Object } from "./s3-client";

/**
 * One shop's backup, end to end: assemble the same bundle the staff export
 * download produces (README, every CSV, photos), add the shop-wide `trips.ics`
 * calendar document, and PUT it to the shop's own bucket under the shop's own
 * sealed credential.
 *
 * Never throws for a per-shop problem — every refusal and failure becomes a
 * recorded delivery row with a code, because "why didn't my backup land" must
 * be answerable from the settings page, not from a log DiveDay holds.
 */

export type BackupRunErrorCode =
  | "encryption_key_unset"
  | "encryption_key_invalid"
  | "credential_unreadable"
  | "shop_missing"
  | "bundle_failed"
  | BackupUploadErrorCode;

export type RunShopBackupResult =
  | { status: "delivered"; deliveryId: string; objectKey: string; byteCount: number }
  | { status: "skipped_already_delivered"; periodKey: string }
  | { status: "no_destination" }
  | { status: "failed"; errorCode: BackupRunErrorCode; deliveryId: string };

export type RunShopBackupInput = {
  shopId: string;
  trigger: BackupDeliveryTrigger;
  /**
   * Translated words for the ride-along `trips.ics`, resolved by the caller
   * against the shop's locale — the same contract as `calendar-sync`'s feed.
   */
  icsLabels: FeedLabels;
  /** Canonical app origin for the event links inside `trips.ics`. */
  origin: string;
  now?: Date;
  /** Used for both the photo fetches and the upload, so tests own all I/O. */
  fetchImpl?: typeof fetch;
} & BackupSecretOptions;

export async function runShopBackup(
  db: AppDb,
  input: RunShopBackupInput,
): Promise<RunShopBackupResult> {
  const now = input.now ?? nowDate();
  const periodKey = backupPeriodKey(now);

  const destination = await getShopBackupDestination(db, input.shopId);
  if (!destination) return { status: "no_destination" };

  if (
    input.trigger === "scheduled" &&
    (await hasDeliveredScheduledBackup(db, input.shopId, periodKey))
  ) {
    return { status: "skipped_already_delivered", periodKey };
  }

  const delivery = await beginBackupDelivery(db, {
    shopId: input.shopId,
    periodKey,
    trigger: input.trigger,
    now,
  });
  const fail = async (errorCode: BackupRunErrorCode): Promise<RunShopBackupResult> => {
    await finishBackupDelivery(db, { id: delivery.id, status: "failed", errorCode, now });
    return { status: "failed", errorCode, deliveryId: delivery.id };
  };

  // Opened only here, at the moment of use, and handed straight to the signer
  // — the plaintext secret never reaches a log, a row, or a return value.
  const credentials = openBackupCredentials(destination, { key: input.key });
  if (!credentials) return fail("credential_unreadable");

  let zip: Uint8Array;
  let shopSlug: string;
  try {
    // The same assembly the platform backup uses (./bundle.ts), so both copies
    // of a shop's data are byte-for-byte the same artifact.
    const bundle = await buildBackupBundle(db, {
      shopId: input.shopId,
      icsLabels: input.icsLabels,
      origin: input.origin,
      now,
      fetchImpl: input.fetchImpl,
    });
    if (!bundle.ok) return fail("shop_missing");
    zip = bundle.zip;
    shopSlug = bundle.shopSlug;
  } catch {
    // A bundle that cannot be assembled is a bug worth a code in the history,
    // not an exception that takes the rest of the cron pass down with it.
    return fail("bundle_failed");
  }

  const objectKey = backupObjectKey(destination.prefix, shopSlug, periodKey);
  const uploaded = await putS3Object({
    endpoint: destination.endpoint,
    region: destination.region,
    bucket: destination.bucket,
    key: objectKey,
    body: zip,
    contentType: "application/zip",
    credentials,
    now,
    fetchImpl: input.fetchImpl,
  });
  if (!uploaded.ok) return fail(uploaded.errorCode);

  await finishBackupDelivery(db, {
    id: delivery.id,
    status: "succeeded",
    objectKey,
    byteCount: zip.byteLength,
    now,
  });
  await markShopBackupVerified(db, input.shopId, now);
  return { status: "delivered", deliveryId: delivery.id, objectKey, byteCount: zip.byteLength };
}
