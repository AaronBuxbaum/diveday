#!/usr/bin/env node
// `pnpm visual:prune` — Cleans up stale visual regression testing snapshots in S3
// while preserving the active main baseline.
//
// Usage:
//   node scripts/prune-visual-bucket.mjs [--dry-run] [--bucket <name>] [--keep <sha>] [--repo <owner/repo>] [--branch <name>]
import process from "node:process";
import { S3Client } from "@aws-sdk/client-s3";

import {
  DEFAULT_BRANCH,
  DEFAULT_BUCKET,
  DEFAULT_REPO,
  pruneVisualBucket,
  resolveActiveBaseline,
} from "./prune-visual-bucket-lib.mjs";
import { gitReader } from "./reg-suit-keys.mjs";

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--bucket") args.bucket = argv[++i];
    else if (arg === "--keep" || arg === "--commit") args.explicitCommit = argv[++i];
    else if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--branch") args.branch = argv[++i];
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
      process.exit(0);
    } else {
      console.error(`prune-visual-bucket: unknown argument "${arg}"`);
      process.exit(1);
    }
  }
  return args;
}

function getS3Client(region = "us-east-1") {
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
    git: gitReader(),
  });

  const { activeBaseline, source } = baselineResult;
  console.log(`Preserving active baseline: ${activeBaseline} (resolved via ${source})`);

  const pruneResult = await pruneVisualBucket({
    s3Client,
    bucket,
    keepShas: [activeBaseline],
    dryRun: args.dryRun,
    log: (msg) => console.log(`  ${msg}`),
  });

  const totalPrefixes = pruneResult.keptPrefixes.length + pruneResult.deletedPrefixes.length;
  console.log("\nPruning summary:");
  console.log(`  Total snapshot prefixes found: ${totalPrefixes}`);
  console.log(
    `  Preserved active prefixes:     ${pruneResult.keptPrefixes.length} (${pruneResult.keptPrefixes.join(", ") || "none"})`,
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
}

main().catch((err) => {
  console.error(`prune-visual-bucket failed: ${err.message}`);
  process.exit(1);
});
