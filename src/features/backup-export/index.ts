/**
 * backup-export — a weekly full-shop backup bundle delivered to storage the
 * shop owns (docs ADR 20260804-shop-owned-backup-export).
 *
 * This file is the module's entire public surface: nothing outside
 * `src/features/backup-export/` may import its internals, and
 * `pnpm check:architecture` enforces that. See ./README.md for the contract.
 *
 * Deliberately absent: `openBackupCredentials` and the raw SigV4 signer. The
 * plaintext secret access key exists only inside `run-backup.ts`, at the
 * moment of upload — a caller that could read it back would put it in a
 * server response, a log line, and eventually a screenshot.
 */

export {
  type BackupDueShop,
  hasDeliveredScheduledBackup,
  listBackupDeliveries,
  listShopsDueForBackup,
} from "./delivery-store";
export {
  type BackupEndpointRefusal,
  type BackupKeyRefusal,
  backupEndpointRefusal,
  disconnectShopBackupDestination,
  getShopBackupDestination,
  type SaveBackupDestinationInput,
  type SaveBackupDestinationRefusal,
  type SaveBackupDestinationResult,
  saveShopBackupDestination,
} from "./destination-store";
export {
  backupPeriodKey,
  backupRunDate,
  type PlatformBackupCensus,
  parsePlatformBackupCensusKey,
  platformBackupCensusKey,
  platformBackupObjectKey,
} from "./period";
export {
  listShopsForPlatformBackup,
  type PlatformBackupConfig,
  type PlatformBackupErrorCode,
  type PlatformBackupResult,
  type PlatformBackupShop,
  platformBackupConfigFromEnvironment,
  type RunPlatformBackupInput,
  runPlatformBackup,
  storePlatformBackupCensus,
} from "./platform-backup";
export {
  type BackupRunErrorCode,
  type RunShopBackupInput,
  type RunShopBackupResult,
  runShopBackup,
} from "./run-backup";
export type { BackupUploadErrorCode } from "./s3-client";
