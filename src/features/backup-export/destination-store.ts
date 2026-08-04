import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import type { ShopBackupDestination } from "@/db/schema";
import { shopBackupDestinations } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { openSecret, type SecretKey, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import type { S3Credentials } from "./s3-client";

/**
 * The store behind a shop's backup destination (docs ADR
 * 20260804-shop-owned-backup-export).
 *
 * Its whole job is to keep the shop's S3 secret access key sealed everywhere
 * except the instant a bundle is uploaded — the same posture as
 * `src/db/whatsapp-accounts.ts`, and for the same reason: the secret *is* the
 * capability to the shop's storage, so nothing here ever returns it to a
 * caller outside this feature, and the module's `index.ts` deliberately does
 * not export the opener.
 *
 * Returns codes, never sentences; the UI picks the words (ADR
 * 20260731-domain-layer-copy-leaks).
 */

export type BackupKeyRefusal = "encryption_key_unset" | "encryption_key_invalid";

export type BackupEndpointRefusal =
  | "endpoint_invalid"
  | "endpoint_not_https"
  | "endpoint_private_host";

export type SaveBackupDestinationRefusal =
  | BackupKeyRefusal
  | BackupEndpointRefusal
  | "secret_required";

/** Options exist so tests can supply a key and a fake fetch without touching the environment. */
export type BackupSecretOptions = {
  key?: SecretKey | null;
};

/**
 * The sealing key, or the reason there isn't one. A missing key is a refusal
 * rather than a silent no-op: a shop pressing "Save" deserves to be told that
 * DiveDay is not configured to hold a credential safely, instead of watching
 * the form appear to succeed and the backup never run.
 */
export function resolveBackupKey(options: BackupSecretOptions): SecretKey | BackupKeyRefusal {
  if (options.key) return options.key;
  if (options.key === null) return "encryption_key_unset";
  const result = secretKeyFromEnvironment();
  if (result.status === "ok") return result.key;
  return result.status === "unset" ? "encryption_key_unset" : "encryption_key_invalid";
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[::1?\]$/,
  /^\[f[cd][0-9a-f]{2}:/i,
  /^\[fe80:/i,
  // IPv4-mapped IPv6 ("[::ffff:7f00:1]" is 127.0.0.1 wearing brackets).
  /^\[::ffff:/i,
  /\.(local|internal|localhost)$/i,
];

/**
 * Why an endpoint cannot be a backup destination, or null when it can.
 *
 * DiveDay's server is the party that will make signed requests to this URL,
 * so an owner-supplied endpoint is server-side request forgery surface:
 * HTTPS only, no embedded credentials or query, and never a loopback,
 * link-local, or private-range host. Hostname-pattern checks, not DNS
 * resolution — a name that resolves privately still yields nothing more than
 * a signed PUT of the shop's own data and a coarse error code back.
 */
export function backupEndpointRefusal(endpoint: string): BackupEndpointRefusal | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "endpoint_invalid";
  }
  if (url.protocol !== "https:") return "endpoint_not_https";
  if (url.username || url.password || url.search || url.hash) return "endpoint_invalid";
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    return "endpoint_private_host";
  }
  return null;
}

export async function getShopBackupDestination(
  db: DbExecutor,
  shopId: string,
): Promise<ShopBackupDestination | null> {
  const [row] = await db
    .select()
    .from(shopBackupDestinations)
    .where(eq(shopBackupDestinations.shopId, shopId))
    .limit(1);
  return row ?? null;
}

export type SaveBackupDestinationInput = {
  shopId: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix?: string | null;
  accessKeyId: string;
  /**
   * Plaintext, straight from the staff form; sealed before it reaches a
   * column. Blank on an *update* keeps the stored secret — the form never
   * echoes it back, so "leave the password field empty" must mean "unchanged",
   * not "erase". Blank on first save is refused.
   */
  secretAccessKey?: string | null;
  now?: Date;
};

export type SaveBackupDestinationResult =
  | { status: "saved"; destination: ShopBackupDestination }
  | { status: "refused"; reason: SaveBackupDestinationRefusal };

/**
 * Save (or re-save) a shop's backup destination. Upsert rather than
 * insert-or-fail: rotating a credential or fixing a mistyped bucket is the
 * same gesture as connecting for the first time.
 */
export async function saveShopBackupDestination(
  db: DbExecutor,
  input: SaveBackupDestinationInput,
  options: BackupSecretOptions = {},
): Promise<SaveBackupDestinationResult> {
  const endpoint = input.endpoint.trim().replace(/\/+$/, "");
  const endpointRefusal = backupEndpointRefusal(endpoint);
  if (endpointRefusal) return { status: "refused", reason: endpointRefusal };

  const key = resolveBackupKey(options);
  if (typeof key === "string") return { status: "refused", reason: key };

  const now = input.now ?? nowDate();
  const secret = input.secretAccessKey?.trim() || null;
  const existing = await getShopBackupDestination(db, input.shopId);
  if (!secret && !existing) return { status: "refused", reason: "secret_required" };

  const values = {
    shopId: input.shopId,
    endpoint,
    region: input.region.trim(),
    bucket: input.bucket.trim(),
    prefix: input.prefix?.trim().replace(/^\/+|\/+$/g, "") ?? "",
    accessKeyId: input.accessKeyId.trim(),
    updatedAt: now,
  };
  // Sealed only when there is a new secret to seal — a blank field on an
  // update leaves the stored ciphertext exactly as it was.
  const sealed = secret ? { secretAccessKeySealed: sealSecret(secret, key) } : {};

  const [destination] = await db
    .insert(shopBackupDestinations)
    .values({
      ...values,
      // The insert arm only runs when `existing` was null, and that path
      // already refused a blank secret above.
      secretAccessKeySealed: secret ? sealSecret(secret, key) : "",
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: shopBackupDestinations.shopId,
      // `connectedAt` survives a re-save — it is when backups were first
      // switched on. `verifiedAt` does not: a changed destination or
      // credential is unproven until a delivery actually lands.
      set: { ...values, ...sealed, verifiedAt: null },
    })
    .returning();
  return { status: "saved", destination };
}

/** Disconnect by deleting the row — holding a live credential a shop revoked serves nobody. Delivery history stays. */
export async function disconnectShopBackupDestination(
  db: DbExecutor,
  shopId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(shopBackupDestinations)
    .where(eq(shopBackupDestinations.shopId, shopId))
    .returning({ shopId: shopBackupDestinations.shopId });
  return deleted.length > 0;
}

/** Record that a bundle actually landed in the bucket, so staff see proven rather than merely saved. */
export async function markShopBackupVerified(
  db: DbExecutor,
  shopId: string,
  now: Date = nowDate(),
): Promise<void> {
  await db
    .update(shopBackupDestinations)
    .set({ verifiedAt: now, updatedAt: now })
    .where(eq(shopBackupDestinations.shopId, shopId));
}

/**
 * The plaintext credentials for one stored row, or null when the secret
 * cannot be opened — no key configured, or a key that no longer matches what
 * sealed this row. **Internal to the feature**: `index.ts` does not export
 * this, so the only consumer is `run-backup.ts` at the moment of upload.
 */
export function openBackupCredentials(
  destination: ShopBackupDestination,
  options: BackupSecretOptions = {},
): S3Credentials | null {
  const key = resolveBackupKey(options);
  if (typeof key === "string") return null;
  const secretAccessKey = openSecret(destination.secretAccessKeySealed, key);
  if (!secretAccessKey) return null;
  return { accessKeyId: destination.accessKeyId, secretAccessKey };
}
