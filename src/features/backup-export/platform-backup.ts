import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { AppDb, DbExecutor } from "@/db/client";
import { boundLockWaits, isLockWaitRefusal } from "@/db/lock-bounds";
import { platformBackupProgress, shops } from "@/db/schema";
import type { FeedLabels } from "@/features/calendar-sync";
import { nowDate } from "@/lib/clock";
import { buildBackupBundle } from "./bundle";
import {
  backupRunDate,
  type PlatformBackupCensus,
  platformBackupCensusKey,
  platformBackupObjectKey,
} from "./period";
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
 * | failure record | a `shop_backup_deliveries` row | scheduler checkpoint and a non-2xx pass |
 *
 * The platform checkpoint is not a user-visible delivery history. It rotates
 * the bounded cron fairly and keeps overlapping invocations from starting the
 * same shop concurrently. The census remains the operator's per-invocation
 * account of the pass.
 *
 * Object keys remain deterministic (`exports/<date>/<slug>.zip`) and the bucket
 * is versioned, so repeated PUTs are additive. The scheduler checkpoint does
 * not prove remote presence: the uploader has no `ListBucket`, deliberately,
 * and the watchdog's separate principal remains the source of that evidence.
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

/** Every real shop, least recently attempted first so a truncated pass rotates across runs. */
export type PlatformBackupShop = { id: string; slug: string; locale: string };

/** A lease lasts longer than the cron's five-minute runtime, including one in-flight shop. */
export const PLATFORM_BACKUP_LEASE_MS = 10 * 60_000;

/**
 * Claim the shop for this invocation without holding a database lock over S3 or
 * bundle I/O. The upsert is atomic: a live lease is unavailable, while an
 * expired lease can be reclaimed after a crashed invocation. A new token fences
 * off a late finisher from an invocation whose lease has since been reclaimed.
 * This fences the database checkpoint only; it cannot prevent a late S3 PUT,
 * whose deterministic object key remains additive in the versioned bucket.
 */
export async function claimPlatformBackupShop(
  db: AppDb,
  input: { shopId: string; token: string; now: Date },
): Promise<boolean> {
  const leaseUntil = new Date(input.now.getTime() + PLATFORM_BACKUP_LEASE_MS);
  try {
    return await db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const [claim] = await tx
        .insert(platformBackupProgress)
        .values({
          shopId: input.shopId,
          lastAttemptAt: input.now,
          leaseToken: input.token,
          leaseUntil,
        })
        .onConflictDoUpdate({
          target: platformBackupProgress.shopId,
          set: {
            lastAttemptAt: input.now,
            leaseToken: input.token,
            leaseUntil,
          },
          where: or(
            isNull(platformBackupProgress.leaseUntil),
            lte(platformBackupProgress.leaseUntil, input.now),
          ),
        })
        .returning({ shopId: platformBackupProgress.shopId });
      return Boolean(claim);
    });
  } catch (error) {
    if (isLockWaitRefusal(error)) return false;
    throw error;
  }
}

/** Commit a successful PUT, or release a failed attempt for the next cron. */
export async function finishPlatformBackupShop(
  db: AppDb,
  input: { shopId: string; token: string; succeeded: boolean; now: Date },
): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const [finished] = await tx
        .update(platformBackupProgress)
        .set({
          ...(input.succeeded ? { lastSuccessAt: input.now } : {}),
          leaseToken: null,
          leaseUntil: null,
        })
        .where(
          and(
            eq(platformBackupProgress.shopId, input.shopId),
            eq(platformBackupProgress.leaseToken, input.token),
          ),
        )
        .returning({ shopId: platformBackupProgress.shopId });
      return Boolean(finished);
    });
  } catch (error) {
    if (isLockWaitRefusal(error)) return false;
    throw error;
  }
}

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
 * Attempt time advances before network work starts. If a pass runs out of time
 * or one shop fails, untouched shops sort ahead of attempted shops next time,
 * including a later weekly period.
 */
export async function listShopsForPlatformBackup(db: DbExecutor): Promise<PlatformBackupShop[]> {
  return (
    db
      .select({ id: shops.id, slug: shops.slug, locale: shops.defaultLocale })
      .from(shops)
      .leftJoin(platformBackupProgress, eq(platformBackupProgress.shopId, shops.id))
      .where(eq(shops.isDemo, false))
      // Null attempts first, then the least recently attempted shop.
      // diveday:allow-time-id-order: a backup pass's visiting order; no one is shown it.
      .orderBy(
        sql`${platformBackupProgress.lastAttemptAt} asc nulls first`,
        sql`${shops.createdAt} asc`,
        sql`${shops.id} asc`,
      )
  );
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

/**
 * File the run's census beside its bundles, so the watchdog can tell a complete
 * pass from a truncated one.
 *
 * Written *after* the loop and never inside it: the whole point of the object is
 * that it states what the finished run set out to do, and a census written
 * per-shop would be a progress bar nobody reads. A pass that dies mid-run
 * therefore leaves no census at all, which is itself the signal -- see the
 * watchdog's `census_missing` alarm.
 *
 * The counts live in the object *key* rather than its body, for reasons worth
 * reading before changing the shape: `platformBackupCensusKey` in `period.ts`.
 * The body is a courtesy for an operator with a console open, and nothing
 * automated parses it.
 *
 * Its failure is deliberately not the pass's failure. Every bundle is already
 * safely stored by the time this runs, and turning "the census PUT was refused"
 * into a 500 would report a *successful* backup as broken -- the opposite of
 * this object's purpose. The caller logs the outcome instead, and a missing
 * census raises its own alarm from AWS a day later, which is the principal
 * that can actually see the bucket.
 */
export async function storePlatformBackupCensus(input: {
  config: PlatformBackupConfig;
  census: PlatformBackupCensus;
  now: Date;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; objectKey: string } | { ok: false; errorCode: BackupUploadErrorCode }> {
  const objectKey = platformBackupCensusKey(backupRunDate(input.now), input.census);
  const uploaded = await putS3Object({
    endpoint: `https://s3.${input.config.region}.amazonaws.com`,
    addressing: "virtual-hosted",
    region: input.config.region,
    bucket: input.config.bucket,
    key: objectKey,
    // Destructured rather than spread, so "counts only, never shop names" is
    // structural instead of aspirational. A spread would publish whatever a
    // future caller happened to hang on the census object -- and the route
    // computes a `failedShops` slug list thirteen lines away.
    body: new TextEncoder().encode(
      `${JSON.stringify(
        {
          shops: input.census.shops,
          stored: input.census.stored,
          failed: input.census.failed,
          skipped: input.census.skipped,
          completedAt: input.now.toISOString(),
        },
        null,
        2,
      )}\n`,
    ),
    contentType: "application/json",
    credentials: {
      accessKeyId: input.config.accessKeyId,
      secretAccessKey: input.config.secretAccessKey,
    },
    now: input.now,
    fetchImpl: input.fetchImpl,
  });
  return uploaded.ok ? { ok: true, objectKey } : { ok: false, errorCode: uploaded.errorCode };
}
