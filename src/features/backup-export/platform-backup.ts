import { asc, eq } from "drizzle-orm";
import type { AppDb, DbExecutor } from "@/db/client";
import { shops } from "@/db/schema";
import type { FeedLabels } from "@/features/calendar-sync";
import { nowDate } from "@/lib/clock";
import { buildBackupBundle } from "./bundle";
import { backupRunDate, platformBackupObjectKey } from "./period";
import { type BackupUploadErrorCode, putS3Object } from "./s3-client";

/**
 * DiveDay's *own* scheduled logical export — the second recovery layer in
 * docs/engineering/backup-and-restore-runbook.md §2, which until now was a
 * bucket and an IAM user with nothing calling one from the other.
 *
 * The sibling of `run-backup.ts`, and deliberately not the same function.
 * They differ in every way that matters operationally:
 *
 * | | shop-owned (`run-backup.ts`) | platform (here) |
 * | credentials | the shop's, AES-sealed per shop | DiveDay's one write-only uploader |
 * | destination | whatever bucket the shop configured | `DatabaseBackupBucket` |
 * | who is owed an answer | the shop, in its settings page | an operator, during an incident |
 * | failure record | a `shop_backup_deliveries` row | a log line and a non-2xx pass |
 *
 * That last row is why there is no ledger table here. A shop needs to see why
 * *its* backup did not land, months later, in a UI. An operator needs to know a
 * *pass* was incomplete, now — which the cron's own response and log line
 * already say. Adding a table to restate that would be schema for its own sake.
 *
 * Idempotency comes from the object key instead: `exports/<date>/<slug>.zip` is
 * deterministic, so a re-run overwrites rather than accumulating, and the bucket
 * is versioned so an overwrite is additive. The cost of having no ledger is that
 * a re-run redoes work it need not redo; on a weekly pass that is cheap, and it
 * is the honest trade for not being able to read the bucket back (the uploader
 * has no `ListBucket`, deliberately — a leaked key must not be able to read a
 * shop's exported waivers).
 */

/** Why a shop's bundle did not reach DiveDay's bucket. Codes, never sentences. */
export type PlatformBackupErrorCode = "shop_missing" | "bundle_failed" | BackupUploadErrorCode;

export type PlatformBackupResult =
  | { status: "stored"; objectKey: string; byteCount: number }
  | { status: "failed"; errorCode: PlatformBackupErrorCode };

/**
 * The uploader credential and where it points. Resolved from the environment by
 * {@link platformBackupConfigFromEnvironment}, which answers `null` when it is
 * not configured — dev, e2e and any deployment that has not been given the
 * credential all keep working, they simply have no platform backup.
 */
export type PlatformBackupConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
};

export type RunPlatformBackupInput = {
  shopId: string;
  config: PlatformBackupConfig;
  /** Translated words for the ride-along `trips.ics`, resolved against the shop's locale. */
  icsLabels: FeedLabels;
  /** Canonical app origin for the event links inside `trips.ics`. */
  origin: string;
  now?: Date;
  /** Used for both the photo fetches and the upload, so tests own all I/O. */
  fetchImpl?: typeof fetch;
};

/** Every shop worth backing up, oldest first so a truncated pass is stable across runs. */
export type PlatformBackupShop = { id: string; slug: string; locale: string };

/**
 * Demo shops are excluded. They are per-visitor test fixtures spun up by the
 * e2e/visual fleet and by anyone clicking "try it"
 * (ADR 20260724-per-visitor-demo-shops) — backing one up would spend real
 * storage on data whose whole purpose is to be discarded, and would bulk out
 * every run prefix the freshness check reads.
 *
 * Worth knowing before it surprises you: the seeded `blue-mantis` fixture is
 * itself flagged `isDemo`, so a local or e2e run of the weekly pass finds *no*
 * shops and stores nothing. That is correct behaviour rather than a bug — but
 * it does mean the pass cannot be smoke-tested by running it against the seed,
 * and `platform-backup.test.ts` drives the flag explicitly for that reason.
 *
 * Ordered by `createdAt` rather than by slug so the sequence is stable as shops
 * are added: a pass that runs out of time always stops at the same place in the
 * list, and the shops it did reach are the same ones as last week.
 */
export async function listShopsForPlatformBackup(db: DbExecutor): Promise<PlatformBackupShop[]> {
  return db
    .select({ id: shops.id, slug: shops.slug, locale: shops.defaultLocale })
    .from(shops)
    .where(eq(shops.isDemo, false))
    .orderBy(asc(shops.createdAt), asc(shops.id));
}

/**
 * Read the uploader credential out of the environment. All four values or
 * nothing: a half-configured uploader looks configured and silently stores
 * nothing, which is the failure mode a backup can least afford.
 */
export function platformBackupConfigFromEnvironment(
  // A plain record rather than `NodeJS.ProcessEnv`: this reads four named keys
  // and nothing else, and the wider type would force every test to invent a
  // `NODE_ENV` it does not care about.
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlatformBackupConfig | null {
  const accessKeyId = env.PLATFORM_BACKUP_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.PLATFORM_BACKUP_AWS_SECRET_ACCESS_KEY?.trim();
  const bucket = env.PLATFORM_BACKUP_BUCKET?.trim();
  const region = env.PLATFORM_BACKUP_AWS_REGION?.trim();
  if (!accessKeyId || !secretAccessKey || !bucket || !region) return null;
  return { accessKeyId, secretAccessKey, bucket, region };
}

/**
 * One shop's bundle into DiveDay's bucket. Never throws for a per-shop problem
 * — one shop's failure must never cost the remaining shops their backup.
 */
export async function runPlatformBackup(
  db: AppDb,
  input: RunPlatformBackupInput,
): Promise<PlatformBackupResult> {
  const now = input.now ?? nowDate();

  let zip: Uint8Array;
  let shopSlug: string;
  try {
    const bundle = await buildBackupBundle(db, {
      shopId: input.shopId,
      icsLabels: input.icsLabels,
      origin: input.origin,
      now,
      fetchImpl: input.fetchImpl,
    });
    if (!bundle.ok) return { status: "failed", errorCode: "shop_missing" };
    zip = bundle.zip;
    shopSlug = bundle.shopSlug;
  } catch {
    return { status: "failed", errorCode: "bundle_failed" };
  }

  const objectKey = platformBackupObjectKey(backupRunDate(now), shopSlug);
  const uploaded = await putS3Object({
    // The regional endpoint with virtual-hosted addressing, which is what AWS
    // S3 itself wants; the shop-owned path stays on portable path-style for the
    // R2/B2/MinIO destinations it has to work against.
    endpoint: `https://s3.${input.config.region}.amazonaws.com`,
    addressing: "virtual-hosted",
    region: input.config.region,
    bucket: input.config.bucket,
    key: objectKey,
    body: zip,
    contentType: "application/zip",
    credentials: {
      accessKeyId: input.config.accessKeyId,
      secretAccessKey: input.config.secretAccessKey,
    },
    now,
    fetchImpl: input.fetchImpl,
  });
  if (!uploaded.ok) return { status: "failed", errorCode: uploaded.errorCode };

  return { status: "stored", objectKey, byteCount: zip.byteLength };
}
