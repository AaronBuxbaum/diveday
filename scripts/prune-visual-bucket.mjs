#!/usr/bin/env node
// `pnpm visual:prune` — Cleans up stale visual regression testing snapshots in S3
// while preserving the active main baseline.
//
// Usage:
//   node scripts/prune-visual-bucket.mjs [--dry-run] [--bucket <name>] [--keep <sha>] [--repo <owner/repo>] [--branch <name>]
//     [--keep-baselines <n>] [--keep-age-hours <h>] [--min-age-hours <h>]
import process from "node:process";
import { S3Client } from "@aws-sdk/client-s3";
import { PRIMARY_REGION } from "../config/aws-regions.mjs";
import {
  DEFAULT_BRANCH,
  DEFAULT_BUCKET,
  DEFAULT_REPO,
  KEEP_MAIN_BASELINE_AGE_MS,
  KEEP_MAIN_BASELINES,
  MIN_PRUNE_AGE_MS,
  MIN_PUBLICATION_GRACE_MS,
  pruneVisualBucket,
  resolveActiveBaseline,
} from "./prune-visual-bucket-lib.mjs";
import { gitReader } from "./reg-suit-keys.mjs";

function parseCount(flag, value, min) {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n) || n < min) {
    console.error(`prune-visual-bucket: ${flag} needs a number >= ${min}, got "${value}"`);
    process.exit(1);
  }
  return n;
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--bucket") args.bucket = argv[++i];
    else if (arg === "--keep" || arg === "--commit") args.explicitCommit = argv[++i];
    else if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--branch") args.branch = argv[++i];
    else if (arg === "--keep-baselines") args.keepBaselines = parseCount(arg, argv[++i], 1);
    else if (arg === "--keep-age-hours") args.keepAgeHours = parseCount(arg, argv[++i], 0);
    else if (arg === "--min-age-hours") args.minAgeHours = parseCount(arg, argv[++i], 0);
    else if (arg === "-h" || arg === "--help") {
      console.log("Usage: node scripts/prune-visual-bucket.mjs [options]");
      console.log("Options:");
      console.log(
        "  --dry-run             Simulate deletions without removing any objects from S3",
      );
      console.log(
        "  --bucket <name>       S3 bucket name (default: REG_SUIT_S3_BUCKET_NAME or diveday-vrt)",
      );
      console.log(
        "  --keep, --commit <sha> Explicit commit SHA to preserve (default: active main baseline)",
      );
      console.log("  --repo <owner/repo>   GitHub repository (default: AaronBuxbaum/diveday)");
      console.log("  --branch <name>       Branch to resolve baseline from (default: main)");
      console.log(
        `  --keep-baselines <n>  Main baselines to keep (default: ${KEEP_MAIN_BASELINES}; 1 = newest only)`,
      );
      console.log(
        `  --keep-age-hours <h>  Also keep main baselines younger than this (default: ${KEEP_MAIN_BASELINE_AGE_MS / 3600000}; 0 = none)`,
      );
      console.log(
        `  --min-age-hours <h>   Never delete a prefix with an object younger than this (default: ${MIN_PRUNE_AGE_MS / 3600000}; floored at ${MIN_PUBLICATION_GRACE_MS / 60000} min)`,
      );
      process.exit(0);
    } else {
      console.error(`prune-visual-bucket: unknown argument "${arg}"`);
      process.exit(1);
    }
  }
  return args;
}

// The bucket's region comes from the stack (REG_SUIT_AWS_REGION), not from a
// literal here: this default was us-east-1 while the bucket moved with the
// estate, and a wrong region reads as an empty bucket rather than an error --
// so a pruner pointed at the wrong region reports having found nothing to prune.
function getS3Client(region = process.env.REG_SUIT_AWS_REGION || PRIMARY_REGION) {
  const accessKeyId = process.env.REG_SUIT_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.REG_SUIT_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  if (accessKeyId && secretAccessKey) {
    return new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  // Fallback to default SDK credential chain (IAM roles, profiles, SSO)
  return new S3Client({ region });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = args.bucket || process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET;
  const repo = args.repo || DEFAULT_REPO;
  const branch = args.branch || DEFAULT_BRANCH;

  console.log(`Pruning visual regression testing bucket: "${bucket}"`);
  if (args.dryRun) {
    console.log("Mode: DRY RUN (no objects will be deleted)");
  }

  const s3Client = getS3Client();

  const baselineResult = await resolveActiveBaseline({
    bucket,
    repo,
    branch,
    explicitCommit: args.explicitCommit,
    ...(args.keepBaselines !== undefined && { keepBaselines: args.keepBaselines }),
    ...(args.keepAgeHours !== undefined && { keepAgeMs: args.keepAgeHours * 3600000 }),
    s3Client,
    git: gitReader(),
  });

  const { activeBaseline, keepShas, verified, source } = baselineResult;
  console.log(`Preserving active baseline: ${activeBaseline} (resolved via ${source})`);
  if (!verified) {
    console.error(
      `prune-visual-bucket: no commit on ${branch} has a published snapshot in "${bucket}".\n` +
        "Nothing was deleted. That usually means the probe cannot read the bucket, not that\n" +
        "every baseline is gone -- check credentials first, then re-run with --keep <sha>.",
    );
    process.exit(1);
  }
  console.log(`Preserving ${keepShas.length} recent main baseline(s)`);

  const pruneResult = await pruneVisualBucket({
    s3Client,
    bucket,
    keepShas,
    dryRun: args.dryRun,
    ...(args.minAgeHours !== undefined && { minAgeMs: args.minAgeHours * 3600000 }),
    log: (msg) => console.log(`  ${msg}`),
  });

  const totalPrefixes =
    pruneResult.keptPrefixes.length +
    pruneResult.keptRecentPrefixes.length +
    pruneResult.deletedPrefixes.length;
  console.log("\nPruning summary:");
  console.log(`  Total snapshot prefixes found: ${totalPrefixes}`);
  console.log(
    `  Preserved active prefixes:     ${pruneResult.keptPrefixes.length} (${pruneResult.keptPrefixes.join(", ") || "none"})`,
  );
  console.log(
    `  Preserved as too recent:       ${pruneResult.keptRecentPrefixes.length} (younger than the prune floor)`,
  );
  console.log(
    `  ${args.dryRun ? "Stale prefixes to delete:" : "Deleted stale prefixes:"}     ${pruneResult.deletedPrefixes.length}`,
  );
  console.log(
    `  ${args.dryRun ? "Objects to delete:" : "Deleted objects count:"}        ${pruneResult.deletedObjectsCount}`,
  );
  console.log(
    `  ${args.dryRun ? "Storage to reclaim:" : "Storage reclaimed:"}          ${Math.round(pruneResult.deletedBytesTotal / (1024 * 1024))} MB`,
  );
  if (pruneResult.deleteErrors.length > 0) {
    console.error(
      `  S3 refused ${pruneResult.deleteErrors.length} deletes -- see the lines above.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`prune-visual-bucket failed: ${err.message}`);
  process.exit(1);
});
