#!/usr/bin/env node
// Publish a trusted, precompressed reg-suit bundle through bounded S3 requests.
// This script is checked out from the immutable reusable-workflow revision. The
// downloaded bundle is data only; no file in it is imported or executed.
import { createHash } from "node:crypto";
import { createReadStream, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

const PARALLELISM = 32;
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 101_000_000;
const MAX_TOTAL_BYTES = 8_100_000_000;
const MAX_MANIFEST_BYTES = 4_000_000;
const MAX_REPORT_COMPRESSED_BYTES = 4_000_000;
const MAX_REPORT_BYTES = 32_000_000;
const MAX_REPORT_ITEMS = 10_000;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/u;
const TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/octet-stream",
  "application/wasm",
  "image/gif",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
  "text/css",
  "text/html",
  "text/plain",
  "font/otf",
  "font/ttf",
  "font/woff",
  "font/woff2",
]);
const TYPES_BY_EXTENSION = new Map([
  [".css", "text/css"],
  [".gif", "image/gif"],
  [".html", "text/html"],
  [".ico", "image/x-icon"],
  [".js", "application/javascript"],
  [".json", "application/json"],
  [".map", "application/json"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".text", "text/plain"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function aborted(signal) {
  if (signal.aborted) throw signal.reason ?? new Error("publisher aborted");
}

function errorCode(error) {
  return error?.Code ?? error?.code ?? error?.name;
}

function isMissing(error) {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    ["NotFound", "NoSuchKey", "404"].includes(errorCode(error))
  );
}

function isPreconditionFailed(error) {
  return (
    error?.$metadata?.httpStatusCode === 412 ||
    ["PreconditionFailed", "412"].includes(errorCode(error))
  );
}

function isConditionalConflict(error) {
  return (
    error?.$metadata?.httpStatusCode === 409 ||
    ["ConditionalRequestConflict", "409"].includes(errorCode(error))
  );
}

function inside(root, candidate) {
  return candidate.startsWith(`${root}${path.sep}`);
}

function requireSafePath(key) {
  if (
    !SAFE_PATH.test(key) ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("//") ||
    key.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("publisher manifest contains an unsafe object path");
  }
}

function classifyKey(key, contentType, snapshotVersion) {
  if (key === "out.json") {
    if (contentType !== "application/json") throw new Error("out.json must be application/json");
    return "marker";
  }
  if (key === "index.html") {
    if (contentType !== "text/html") throw new Error("index.html must be text/html");
    return "root-static";
  }
  if (key === "detector.wasm") {
    if (contentType !== "application/wasm")
      throw new Error("detector.wasm must be application/wasm");
    return "root-static";
  }

  const prefix = `snapshots/${snapshotVersion}/`;
  if (!key.startsWith(prefix)) {
    throw new Error(`publisher object is outside snapshot ${snapshotVersion}: ${key}`);
  }
  const relative = key.slice(prefix.length);
  const slash = relative.indexOf("/");
  if (slash < 1 || !["actual", "expected", "diff"].includes(relative.slice(0, slash))) {
    throw new Error(`publisher object is outside the versioned image directories: ${key}`);
  }
  if (contentType === "application/wasm" || !TYPES.has(contentType)) {
    throw new Error(`unsupported publisher content type for ${key}`);
  }
  const expectedType = TYPES_BY_EXTENSION.get(path.extname(relative).toLowerCase());
  if (!expectedType || expectedType !== contentType) {
    throw new Error(`publisher content type does not match its extension: ${key}`);
  }
  if (relative.toLowerCase().endsWith(".wasm")) {
    throw new Error(`WebAssembly is allowed only at the root detector.wasm key`);
  }
  return "snapshot-asset";
}

async function sha256File(file, signal, onChunk) {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  const stop = () => stream.destroy(signal.reason ?? new Error("publisher aborted"));
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const chunk of stream) {
      aborted(signal);
      hash.update(chunk);
      onChunk?.(chunk.length);
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
  aborted(signal);
  return hash.digest("hex");
}

function readVersionedReport(marker) {
  if (marker.size > MAX_REPORT_COMPRESSED_BYTES) {
    throw new Error("compressed out.json exceeds publisher report limit");
  }
  let json;
  try {
    const compressed = marker.bytes;
    json = gunzipSync(compressed, { maxOutputLength: MAX_REPORT_BYTES }).toString("utf8");
  } catch {
    throw new Error("out.json is not a bounded gzip report");
  }
  let report;
  try {
    report = JSON.parse(json);
  } catch {
    throw new Error("out.json is not valid JSON");
  }
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.actualDir !== `snapshots/${marker.snapshotVersion}/actual` ||
    report.expectedDir !== `snapshots/${marker.snapshotVersion}/expected` ||
    report.diffDir !== `snapshots/${marker.snapshotVersion}/diff` ||
    !Array.isArray(report.actualItems) ||
    report.actualItems.length > MAX_REPORT_ITEMS
  ) {
    throw new Error("out.json does not describe the requested snapshot version");
  }
  const names = new Set();
  for (const name of report.actualItems) {
    if (typeof name !== "string" || !SAFE_NAME.test(name) || names.has(name)) {
      throw new Error("out.json contains an unsafe or duplicate actual item");
    }
    names.add(name);
  }
  return [...names];
}

async function validateBundle({
  bundle,
  actualKey,
  snapshotVersion,
  bucket,
  prNumber,
  signal,
  onEvent,
}) {
  aborted(signal);
  if (!/^[0-9a-f]{40}$/u.test(actualKey ?? "")) throw new Error("invalid immutable snapshot key");
  if (!/^[0-9a-f]{64}$/u.test(snapshotVersion ?? "")) throw new Error("invalid snapshot version");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket ?? ""))
    throw new Error("invalid S3 bucket");
  if (prNumber && !/^[1-9][0-9]*$/u.test(prNumber)) throw new Error("invalid PR number");

  const bundleStat = lstatSync(bundle);
  if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink()) {
    throw new Error("bundle must be a real directory");
  }
  const root = realpathSync(bundle);
  const payloadDir = path.join(root, "payload");
  const manifestFile = path.join(root, "manifest.tsv");
  const manifestStat = lstatSync(manifestFile);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error("manifest must be a regular file");
  }
  if (manifestStat.size > MAX_MANIFEST_BYTES)
    throw new Error("publisher manifest exceeds size limit");
  const payloadStat = lstatSync(payloadDir);
  if (
    !payloadStat.isDirectory() ||
    payloadStat.isSymbolicLink() ||
    realpathSync(payloadDir) !== payloadDir
  ) {
    throw new Error("payload must be a real directory inside the bundle");
  }
  const payloadRoot = realpathSync(payloadDir);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let manifestText;
  try {
    manifestText = decoder.decode(readFileSync(manifestFile));
  } catch {
    throw new Error("publisher manifest must be valid UTF-8");
  }

  const entries = [];
  const keys = new Set();
  let totalBytes = 0;
  let marker;
  for (const line of manifestText.split(/\r?\n/u)) {
    aborted(signal);
    if (!line) continue;
    if (entries.length >= MAX_FILES) throw new Error("publisher manifest exceeds file-count limit");
    const fields = line.split("\t");
    if (fields.length !== 2) throw new Error("malformed publisher manifest");
    const [key, contentType] = fields;
    requireSafePath(key);
    if (keys.has(key)) throw new Error(`publisher manifest contains a duplicate key: ${key}`);
    keys.add(key);
    const kind = classifyKey(key, contentType, snapshotVersion);
    const file = path.join(payloadDir, `${key}.gz`);
    const fileStat = lstatSync(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`publisher payload must be a regular file: ${key}`);
    }
    if (kind === "marker" && fileStat.size > MAX_REPORT_COMPRESSED_BYTES) {
      throw new Error("compressed out.json exceeds publisher report limit");
    }
    if (fileStat.size > MAX_FILE_BYTES) throw new Error(`publisher payload is too large: ${key}`);
    const resolvedFile = realpathSync(file);
    if (!inside(payloadRoot, resolvedFile))
      throw new Error(`publisher payload escapes its root: ${key}`);
    totalBytes += fileStat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("publisher payload exceeds size limit");
    const entry = { key, contentType, kind, file, size: fileStat.size };
    if (kind === "marker") marker = entry;
    entries.push(entry);
  }
  if (!entries.length || !marker)
    throw new Error("publisher manifest must contain exactly one out.json marker");

  for (const entry of entries) {
    entry.sha256 = await sha256File(entry.file, signal, (size) =>
      onEvent("preflight-chunk", entry.key, size),
    );
  }
  marker.snapshotVersion = snapshotVersion;
  const actualItems = readVersionedReport({ ...marker, bytes: readFileSync(marker.file) });
  const actualKeys = new Set(
    entries.filter((entry) => entry.kind === "snapshot-asset").map((entry) => entry.key),
  );
  for (const name of actualItems) {
    if (!actualKeys.has(`snapshots/${snapshotVersion}/actual/${name}`)) {
      throw new Error(`out.json actual item is missing from the publisher manifest: ${name}`);
    }
  }
  return { entries, marker, assets: entries.filter((entry) => entry.kind !== "marker") };
}

async function send(client, command, signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return client.send(command, { abortSignal: AbortSignal.any([signal, timeout]) });
}

async function headObject({ client, commands, bucket, actualKey, key, signal, timeoutMs }) {
  return send(
    client,
    new commands.HeadObjectCommand({
      Bucket: bucket,
      Key: `${actualKey}/${key}`,
      ChecksumMode: "ENABLED",
    }),
    signal,
    timeoutMs,
  );
}

function expectedMetadata(entry, prNumber) {
  const metadata = {
    "diveday-sha256": entry.sha256,
    "diveday-size": String(entry.size),
  };
  if (prNumber) metadata["diveday-pr-number"] = prNumber;
  if (entry.kind === "marker") metadata["diveday-snapshot-version"] = entry.snapshotVersion;
  return metadata;
}

function metadataMatches(head, entry, prNumber) {
  const expected = expectedMetadata(entry, prNumber);
  const actual = head?.Metadata ?? {};
  const ownerMatches = prNumber
    ? actual["diveday-pr-number"] === prNumber
    : actual["diveday-pr-number"] === undefined || actual["diveday-pr-number"] === "None";
  return (
    head?.ContentLength === entry.size &&
    head?.ContentType === entry.contentType &&
    head?.ContentEncoding === "gzip" &&
    ownerMatches &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

async function hashExistingBody({
  client,
  commands,
  bucket,
  actualKey,
  entry,
  head,
  signal,
  timeoutMs,
}) {
  if (!head.ETag) return false;
  const result = await send(
    client,
    new commands.GetObjectCommand({
      Bucket: bucket,
      Key: `${actualKey}/${entry.key}`,
      IfMatch: head.ETag,
    }),
    signal,
    timeoutMs,
  );
  const body = result.Body;
  if (!body || typeof body[Symbol.asyncIterator] !== "function") {
    body?.destroy?.();
    return false;
  }
  const requestSignal = AbortSignal.timeout(timeoutMs);
  const signalBoth = AbortSignal.any([signal, requestSignal]);
  const stopBody = () => body.destroy?.(signalBoth.reason ?? new Error("publisher aborted"));
  signalBoth.addEventListener("abort", stopBody, { once: true });
  const hash = createHash("sha256");
  try {
    if (signalBoth.aborted) {
      stopBody();
      throw signalBoth.reason ?? new Error("publisher aborted");
    }
    for await (const chunk of body) {
      aborted(signalBoth);
      hash.update(chunk);
    }
    aborted(signalBoth);
  } catch (error) {
    if (signalBoth.aborted) throw signalBoth.reason ?? error;
    throw error;
  } finally {
    signalBoth.removeEventListener("abort", stopBody);
  }
  return (
    result.ContentLength === entry.size &&
    result.ContentType === entry.contentType &&
    result.ContentEncoding === "gzip" &&
    hash.digest("hex") === entry.sha256
  );
}

async function existingMatches({
  client,
  commands,
  bucket,
  actualKey,
  entry,
  prNumber,
  signal,
  timeoutMs,
}) {
  const head = await headObject({
    client,
    commands,
    bucket,
    actualKey,
    key: entry.key,
    signal,
    timeoutMs,
  });
  if (!metadataMatches(head, entry, prNumber)) return { matches: false, head };
  const expectedChecksum = Buffer.from(entry.sha256, "hex").toString("base64");
  if (head.ChecksumSHA256 === expectedChecksum) return { matches: true, head };
  return {
    matches: await hashExistingBody({
      client,
      commands,
      bucket,
      actualKey,
      entry,
      head,
      signal,
      timeoutMs,
    }),
    head,
  };
}

async function pool(items, task, signal) {
  let cursor = 0;
  let failure;
  const stop = new AbortController();
  const poolSignal = AbortSignal.any([signal, stop.signal]);
  const workers = Array.from({ length: Math.min(PARALLELISM, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      try {
        aborted(poolSignal);
        const item = items[cursor++];
        await task(item, poolSignal);
      } catch (error) {
        failure ??= error;
        stop.abort(error);
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
  aborted(signal);
}

function markerVersion(head) {
  return head?.Metadata?.["diveday-snapshot-version"] ?? "legacy";
}

function markerOwnerMatches(head, prNumber) {
  return (head?.Metadata?.["diveday-pr-number"] ?? "None") === (prNumber || "None");
}

async function readMarker({
  client,
  commands,
  bucket,
  actualKey,
  marker,
  prNumber,
  signal,
  timeoutMs,
}) {
  try {
    const head = await headObject({
      client,
      commands,
      bucket,
      actualKey,
      key: "out.json",
      signal,
      timeoutMs,
    });
    if (!markerOwnerMatches(head, prNumber)) {
      throw new Error(`publisher ownership mismatch at ${actualKey}/out.json`);
    }
    if (markerVersion(head) === marker.snapshotVersion) {
      return { state: "same-version", head };
    }
    if (!head.ETag) throw new Error(`snapshot marker has no ETag at ${actualKey}/out.json`);
    return { state: "replace", head };
  } catch (error) {
    if (isMissing(error)) return { state: "absent", head: null };
    throw error;
  }
}

async function putObject({
  client,
  commands,
  bucket,
  actualKey,
  entry,
  prNumber,
  signal,
  timeoutMs,
  condition,
}) {
  const metadata = expectedMetadata(entry, prNumber);
  const checksum = Buffer.from(entry.sha256, "hex").toString("base64");
  const body = createReadStream(entry.file);
  body.on("error", () => {});
  const input = {
    Bucket: bucket,
    Key: `${actualKey}/${entry.key}`,
    Body: body,
    ContentLength: entry.size,
    ContentType: entry.contentType,
    ContentEncoding: "gzip",
    Metadata: metadata,
    ChecksumSHA256: checksum,
    ...condition,
  };
  try {
    const result = await send(client, new commands.PutObjectCommand(input), signal, timeoutMs);
    if (result.ChecksumSHA256 !== checksum) {
      throw new Error(`S3 checksum response mismatch at ${actualKey}/${entry.key}`);
    }
    return result;
  } catch (error) {
    body.destroy();
    if (!body.closed) await new Promise((resolve) => body.once("close", resolve));
    throw error;
  }
}

async function putCreateOnly(args) {
  try {
    return await putObject({ ...args, condition: { IfNoneMatch: "*" } });
  } catch (error) {
    if (!isConditionalConflict(error)) throw error;
    // S3 recommends one retry after a conditional-write 409.
    return putObject({ ...args, condition: { IfNoneMatch: "*" } });
  }
}

async function publishImmutableAsset(args, onEvent) {
  try {
    await putCreateOnly(args);
    onEvent("uploaded", args.entry.key);
    return;
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
  }
  const prior = await existingMatches(args);
  if (!prior.matches)
    throw new Error(
      `immutable snapshot provenance mismatch at ${args.actualKey}/${args.entry.key}`,
    );
  onEvent("reused", args.entry.key);
}

async function publishRootStatic(args, onEvent) {
  let prior;
  try {
    prior = await existingMatches(args);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (prior) {
    if (!prior.matches)
      throw new Error(`root asset provenance mismatch at ${args.actualKey}/${args.entry.key}`);
    onEvent("reused", args.entry.key);
    return;
  }
  try {
    await putCreateOnly(args);
    onEvent("uploaded", args.entry.key);
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
    const competing = await existingMatches(args);
    if (!competing.matches)
      throw new Error(`root asset provenance mismatch at ${args.actualKey}/${args.entry.key}`);
    onEvent("reused", args.entry.key);
  }
}

async function verifyBundle({
  client,
  commands,
  bucket,
  actualKey,
  entries,
  prNumber,
  signal,
  timeoutMs,
  onEvent,
}) {
  await pool(
    entries,
    async (entry, poolSignal) => {
      const prior = await existingMatches({
        client,
        commands,
        bucket,
        actualKey,
        entry,
        prNumber,
        signal: poolSignal,
        timeoutMs,
      });
      if (!prior.matches)
        throw new Error(`snapshot provenance mismatch at ${actualKey}/${entry.key}`);
      onEvent("verified", entry.key);
    },
    signal,
  );
}

async function publishMarker({
  client,
  commands,
  bucket,
  actualKey,
  marker,
  prNumber,
  markerState,
  signal,
  timeoutMs,
  entries,
  onEvent,
}) {
  const condition =
    markerState.state === "absent" ? { IfNoneMatch: "*" } : { IfMatch: markerState.head.ETag };
  try {
    const args = {
      client,
      commands,
      bucket,
      actualKey,
      entry: marker,
      prNumber,
      signal,
      timeoutMs,
      condition,
    };
    if (markerState.state === "absent") await putCreateOnly(args);
    else await putObject(args);
    onEvent("marker-published", marker.key);
    return markerState.state === "absent" ? "published" : "replaced";
  } catch (error) {
    if (markerState.state === "absent" && isPreconditionFailed(error)) {
      const current = await readMarker({
        client,
        commands,
        bucket,
        actualKey,
        marker,
        prNumber,
        signal,
        timeoutMs,
      });
      if (current.state === "same-version") {
        await verifyBundle({
          client,
          commands,
          bucket,
          actualKey,
          entries,
          prNumber,
          signal,
          timeoutMs,
          onEvent,
        });
        return "provenance-verified";
      }
    }
    if (isPreconditionFailed(error) || isConditionalConflict(error)) {
      throw new Error(`snapshot marker changed during publication at ${actualKey}/out.json`);
    }
    throw error;
  }
}

export async function publishBundle({
  client,
  commands,
  bundle,
  actualKey,
  snapshotVersion,
  bucket,
  prNumber = "",
  signal = new AbortController().signal,
  onEvent = () => {},
  requestTimeoutMs = 60_000,
}) {
  const { entries, marker, assets } = await validateBundle({
    bundle,
    actualKey,
    snapshotVersion,
    bucket,
    prNumber,
    signal,
    onEvent,
  });
  const markerState = await readMarker({
    client,
    commands,
    bucket,
    actualKey,
    marker,
    prNumber,
    signal,
    timeoutMs: requestTimeoutMs,
  });

  if (markerState.state === "same-version") {
    await verifyBundle({
      client,
      commands,
      bucket,
      actualKey,
      entries,
      prNumber,
      signal,
      timeoutMs: requestTimeoutMs,
      onEvent,
    });
    return { status: "provenance-verified", count: entries.length };
  }

  await pool(
    assets,
    async (entry, poolSignal) => {
      const args = {
        client,
        commands,
        bucket,
        actualKey,
        entry,
        prNumber,
        signal: poolSignal,
        timeoutMs: requestTimeoutMs,
      };
      if (entry.kind === "snapshot-asset") await publishImmutableAsset(args, onEvent);
      else await publishRootStatic(args, onEvent);
    },
    signal,
  );
  const markerResult = await publishMarker({
    client,
    commands,
    bucket,
    actualKey,
    marker,
    prNumber,
    markerState,
    signal,
    timeoutMs: requestTimeoutMs,
    entries,
    onEvent,
  });
  return { status: markerResult, count: entries.length };
}

async function main() {
  const bundle = path.resolve(process.env.VISUAL_PUBLISH_BUNDLE ?? "reg-suit-publish-bundle");
  const actualKey = process.env.REG_ACTUAL_KEY;
  const snapshotVersion = process.env.SNAPSHOT_VERSION;
  const bucket = process.env.REG_SUIT_S3_BUCKET_NAME;
  const region = process.env.REG_SUIT_AWS_REGION;
  const prNumber = process.env.PR_NUMBER ?? "";
  if (!region) throw new Error("missing AWS region");
  const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const client = new S3Client({ region, maxAttempts: 3 });
  const controller = new AbortController();
  const abort = (signal) => controller.abort(new Error(`publisher interrupted by ${signal}`));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const result = await publishBundle({
      client,
      commands: { HeadObjectCommand, GetObjectCommand, PutObjectCommand },
      bundle,
      actualKey,
      snapshotVersion,
      bucket,
      prNumber,
      signal: controller.signal,
      onEvent: (event, key) => {
        if (event === "uploaded" || event === "marker-published") console.log(`Published ${key}`);
      },
    });
    console.log(
      `${result.status}: ${result.count} objects for ${actualKey} version ${snapshotVersion}`,
    );
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    client.destroy();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`reg-suit-publish-bundle: ${error.message}`);
    process.exitCode = 1;
  });
}
