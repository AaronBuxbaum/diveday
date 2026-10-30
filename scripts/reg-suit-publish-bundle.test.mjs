import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { test } from "vitest";

import { publishBundle } from "./reg-suit-publish-bundle.mjs";

const COMMIT = "a".repeat(40);
const VERSION_1 = "b".repeat(64);
const VERSION_2 = "c".repeat(64);
const VERSION_3 = "d".repeat(64);
const BUCKET = "diveday-vrt";
const PR = "3325";
const COMMANDS = {
  HeadObjectCommand: class HeadObjectCommand {
    constructor(input) {
      this.input = input;
    }
  },
  GetObjectCommand: class GetObjectCommand {
    constructor(input) {
      this.input = input;
    }
  },
  PutObjectCommand: class PutObjectCommand {
    constructor(input) {
      this.input = input;
    }
  },
};

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function checksum(bytes) {
  return Buffer.from(digest(bytes), "hex").toString("base64");
}

function s3Error(name, status) {
  const error = new Error(name);
  error.name = name;
  error.Code = name;
  error.$metadata = { httpStatusCode: status };
  return error;
}

function fixture({
  version = VERSION_1,
  capture = "capture one",
  index = "<main>visual report</main>",
  detector = false,
  count = 1,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "diveday-sdk-publisher-"));
  const bundle = path.join(root, "bundle");
  const payload = path.join(bundle, "payload");
  mkdirSync(payload, { recursive: true });
  const entries = [];
  for (let index = 0; index < count; index++) {
    const name = count === 1 ? "capture.png" : `capture-${String(index).padStart(3, "0")}.png`;
    for (const [directory, type, content] of [
      ["actual", "image/png", `${capture} actual ${index}`],
      ["expected", "image/png", `expected ${index}`],
      ["diff", "image/png", `diff ${index}`],
    ]) {
      entries.push({
        key: `snapshots/${version}/${directory}/${name}`,
        contentType: type,
        bytes: Buffer.from(content),
      });
    }
  }
  entries.push({ key: "index.html", contentType: "text/html", bytes: Buffer.from(index) });
  if (detector)
    entries.push({
      key: "detector.wasm",
      contentType: "application/wasm",
      bytes: Buffer.from([0, 97, 115, 109]),
    });
  entries.push({
    key: "out.json",
    contentType: "application/json",
    bytes: Buffer.from(
      JSON.stringify({
        actualDir: `snapshots/${version}/actual`,
        expectedDir: `snapshots/${version}/expected`,
        diffDir: `snapshots/${version}/diff`,
        actualItems: Array.from({ length: count }, (_, i) =>
          count === 1 ? "capture.png" : `capture-${String(i).padStart(3, "0")}.png`,
        ),
      }),
    ),
  });
  entries.sort((a, b) => a.key.localeCompare(b.key));
  for (const entry of entries) {
    entry.gz = gzipSync(entry.bytes, { level: 9, mtime: 0 });
    const file = path.join(payload, `${entry.key}.gz`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, entry.gz);
  }
  writeFileSync(
    path.join(bundle, "manifest.tsv"),
    `${entries.map((entry) => `${entry.key}\t${entry.contentType}`).join("\n")}\n`,
  );
  return { root, bundle, entries, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function storedObject({
  key,
  bytes,
  contentType,
  prNumber = PR,
  snapshotVersion,
  checksumPresent = true,
  metadataOverrides = {},
}) {
  const metadata = {
    "diveday-sha256": digest(bytes),
    "diveday-size": String(bytes.length),
    "diveday-pr-number": prNumber || "None",
    ...metadataOverrides,
  };
  if (key.endsWith("/out.json") && snapshotVersion)
    metadata["diveday-snapshot-version"] = snapshotVersion;
  const etag = `"${digest(bytes).slice(0, 32)}"`;
  const head = {
    ContentLength: bytes.length,
    ContentType: contentType,
    ContentEncoding: "gzip",
    Metadata: metadata,
    ETag: etag,
  };
  if (checksumPresent) head.ChecksumSHA256 = checksum(bytes);
  else head.ChecksumCRC64NVME = "crc64-only";
  return { bytes: Buffer.from(bytes), head };
}

function mapFromFixture(f, { version = VERSION_1, prNumber = PR, checksumPresent = true } = {}) {
  const result = new Map();
  for (const entry of f.entries) {
    const key = `${BUCKET}/${COMMIT}/${entry.key}`;
    result.set(
      key,
      storedObject({
        key,
        bytes: entry.gz,
        contentType: entry.contentType,
        prNumber,
        snapshotVersion: entry.key === "out.json" ? version : undefined,
        checksumPresent,
      }),
    );
  }
  return result;
}

function fakeS3({
  initial = new Map(),
  failPutKey = "",
  conflictOnceKey = "",
  hangHeadKey = "",
  hangGetKey = "",
  onPut,
} = {}) {
  const objects = new Map(initial);
  const events = [];
  let active = 0;
  let maxActive = 0;
  let conflictUsed = false;
  const client = {
    objects,
    events,
    get maxActive() {
      return maxActive;
    },
    async send(command, { abortSignal } = {}) {
      if (abortSignal?.aborted) throw abortSignal.reason;
      const kind = command.constructor.name;
      const input = command.input;
      const key = `${input.Bucket}/${input.Key}`;
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        if (kind === "HeadObjectCommand") {
          events.push(["HEAD", key, input.ChecksumMode]);
          if (hangHeadKey === key) {
            await new Promise((_resolve, reject) => {
              abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), {
                once: true,
              });
            });
          }
          const stored = objects.get(key);
          if (!stored) throw s3Error("NotFound", 404);
          return structuredClone(stored.head);
        }
        if (kind === "GetObjectCommand") {
          events.push(["GET", key, input.IfMatch]);
          const stored = objects.get(key);
          if (!stored) throw s3Error("NoSuchKey", 404);
          if (input.IfMatch !== stored.head.ETag) throw s3Error("PreconditionFailed", 412);
          if (hangGetKey === key) {
            return {
              ContentLength: stored.head.ContentLength,
              ContentType: stored.head.ContentType,
              ContentEncoding: stored.head.ContentEncoding,
              Body: new Readable({ read() {} }),
            };
          }
          return {
            ContentLength: stored.head.ContentLength,
            ContentType: stored.head.ContentType,
            ContentEncoding: stored.head.ContentEncoding,
            Body: Readable.from([stored.bytes]),
          };
        }
        if (kind === "PutObjectCommand") {
          events.push(["PUT_START", key, input.IfNoneMatch ?? input.IfMatch]);
          await onPut?.({ key, input, objects });
          if (failPutKey === key) throw new Error(`injected upload failure at ${key}`);
          if (conflictOnceKey === key && !conflictUsed) {
            conflictUsed = true;
            const competingChunks = [];
            for await (const chunk of input.Body) competingChunks.push(chunk);
            const competingBytes = Buffer.concat(competingChunks);
            objects.set(
              key,
              storedObject({
                key,
                bytes: competingBytes,
                contentType: input.ContentType,
                prNumber:
                  input.Metadata["diveday-pr-number"] === "None"
                    ? ""
                    : input.Metadata["diveday-pr-number"],
                snapshotVersion: input.Metadata["diveday-snapshot-version"],
                metadataOverrides: input.Metadata,
              }),
            );
            events.push(["REMOTE_PUT", key]);
            throw s3Error("ConditionalRequestConflict", 409);
          }
          const current = objects.get(key);
          if (input.IfNoneMatch === "*" && current) throw s3Error("PreconditionFailed", 412);
          if (input.IfMatch && (!current || current.head.ETag !== input.IfMatch))
            throw s3Error("PreconditionFailed", 412);
          const chunks = [];
          for await (const chunk of input.Body) {
            if (abortSignal?.aborted) throw abortSignal.reason;
            chunks.push(chunk);
          }
          const bytes = Buffer.concat(chunks);
          if (bytes.length !== input.ContentLength || checksum(bytes) !== input.ChecksumSHA256) {
            throw new Error(`bad request checksum at ${key}`);
          }
          const next = storedObject({
            key,
            bytes,
            contentType: input.ContentType,
            prNumber:
              input.Metadata["diveday-pr-number"] === "None"
                ? ""
                : input.Metadata["diveday-pr-number"],
            snapshotVersion: input.Metadata["diveday-snapshot-version"],
            metadataOverrides: input.Metadata,
          });
          if (!Object.hasOwn(input.Metadata, "diveday-pr-number")) {
            delete next.head.Metadata["diveday-pr-number"];
          }
          objects.set(key, next);
          events.push(["PUT_DONE", key, input.IfNoneMatch ?? input.IfMatch]);
          await delay(1);
          return { ChecksumSHA256: checksum(bytes) };
        }
        throw new Error(`unexpected fake S3 command ${kind}`);
      } finally {
        active--;
      }
    },
    destroy() {},
  };
  return client;
}

function args(f, client, overrides = {}) {
  return {
    client,
    commands: COMMANDS,
    bundle: f.bundle,
    actualKey: COMMIT,
    snapshotVersion: VERSION_1,
    bucket: BUCKET,
    prNumber: PR,
    requestTimeoutMs: 250,
    ...overrides,
  };
}

test("publishes versioned objects with bounded workers and the root marker last", async () => {
  const f = fixture({ count: 40, detector: true });
  try {
    const s3 = fakeS3();
    const result = await publishBundle(args(f, s3));
    assert.deepEqual(result, { status: "published", count: f.entries.length });
    assert.ok(s3.maxActive <= 32 && s3.maxActive > 1);
    const markerStart = s3.events.findIndex(
      ([event, key]) => event === "PUT_START" && key === `${BUCKET}/${COMMIT}/out.json`,
    );
    assert.ok(markerStart > 0);
    const completedBeforeMarker = new Set(
      s3.events
        .slice(0, markerStart)
        .filter(([event]) => event === "PUT_DONE")
        .map(([, key]) => key),
    );
    for (const entry of f.entries.filter((item) => item.key !== "out.json")) {
      assert.ok(
        completedBeforeMarker.has(`${BUCKET}/${COMMIT}/${entry.key}`),
        `${entry.key} must finish before out.json`,
      );
    }
    const markerDone = s3.events.findIndex(
      ([event, key]) => event === "PUT_DONE" && key === `${BUCKET}/${COMMIT}/out.json`,
    );
    assert.equal(markerDone, s3.events.length - 1);
    assert.ok(
      s3.events
        .filter(([event]) => event === "PUT_DONE")
        .every(
          ([, key]) =>
            key.startsWith(`${BUCKET}/${COMMIT}/snapshots/${VERSION_1}/`) ||
            key === `${BUCKET}/${COMMIT}/index.html` ||
            key === `${BUCKET}/${COMMIT}/detector.wasm` ||
            key === `${BUCKET}/${COMMIT}/out.json`,
        ),
    );
    assert.equal(
      s3.objects.get(`${BUCKET}/${COMMIT}/out.json`).head.Metadata["diveday-snapshot-version"],
      VERSION_1,
    );
  } finally {
    f.cleanup();
  }
});

test("publishes a 3,481-object inventory through at most 32 active SDK requests", async () => {
  const f = fixture({ count: 1160 });
  try {
    const omitted = f.entries.find((entry) => entry.key.includes("/diff/"));
    f.entries.splice(f.entries.indexOf(omitted), 1);
    rmSync(path.join(f.bundle, "payload", `${omitted.key}.gz`));
    writeFileSync(
      path.join(f.bundle, "manifest.tsv"),
      `${f.entries.map((entry) => `${entry.key}\t${entry.contentType}`).join("\n")}\n`,
    );
    assert.equal(f.entries.length, 3481);
    const s3 = fakeS3();
    const result = await publishBundle(args(f, s3));
    assert.equal(result.count, 3481);
    assert.ok(s3.maxActive <= 32 && s3.maxActive > 1);
    assert.equal(s3.events.filter(([event]) => event === "PUT_DONE").length, 3481);
    assert.equal(s3.events.at(-1)[1], `${BUCKET}/${COMMIT}/out.json`);
  } finally {
    f.cleanup();
  }
});

test("same-version retries cryptographically verify CRC-only legacy object checksums", async () => {
  const f = fixture();
  try {
    const first = fakeS3();
    await publishBundle(args(f, first));
    for (const object of first.objects.values()) {
      const { ChecksumSHA256: _discard, ...rest } = object.head;
      object.head = { ...rest, ChecksumCRC64NVME: "crc64-only" };
    }
    first.events.length = 0;
    const result = await publishBundle(args(f, first));
    assert.equal(result.status, "provenance-verified");
    assert.equal(first.events.filter(([event]) => event === "PUT_START").length, 0);
    assert.equal(first.events.filter(([event]) => event === "GET").length, f.entries.length);
    assert.ok(first.events.filter(([event]) => event === "GET").every(([, , etag]) => etag));
  } finally {
    f.cleanup();
  }
});

test.each(["absent", "none"])(
  "main-owner same-version retries accept %s PR ownership metadata",
  async (representation) => {
    const f = fixture();
    try {
      const initial = mapFromFixture(f, { prNumber: "" });
      for (const object of initial.values()) {
        if (representation === "absent") delete object.head.Metadata["diveday-pr-number"];
        else object.head.Metadata["diveday-pr-number"] = "None";
      }
      const s3 = fakeS3({ initial });
      await assert.doesNotReject(
        publishBundle(args(f, s3, { prNumber: "" })),
        `same-version main retry should accept ${representation} owner metadata`,
      );
    } finally {
      f.cleanup();
    }
  },
);

test("main publication omits pull-request ownership metadata", async () => {
  const f = fixture();
  try {
    const s3 = fakeS3();
    await publishBundle(args(f, s3, { prNumber: "" }));
    for (const object of s3.objects.values()) {
      assert.equal(object.head.Metadata["diveday-pr-number"], undefined);
    }
  } finally {
    f.cleanup();
  }
});

test("a changed same-owner version replaces only the root marker after all new assets", async () => {
  const old = fixture({ version: VERSION_1 });
  const current = fixture({ version: VERSION_2, capture: "capture two" });
  try {
    const s3 = fakeS3();
    await publishBundle(args(old, s3));
    const prior = new Map(
      [...s3.objects].map(([key, value]) => [
        key,
        { bytes: Buffer.from(value.bytes), head: structuredClone(value.head) },
      ]),
    );
    s3.events.length = 0;
    const result = await publishBundle(args(current, s3, { snapshotVersion: VERSION_2 }));
    assert.equal(result.status, "replaced");
    assert.ok(
      s3.events.some(
        ([event, key, condition]) =>
          event === "PUT_DONE" &&
          key === `${BUCKET}/${COMMIT}/out.json` &&
          condition === prior.get(`${BUCKET}/${COMMIT}/out.json`).head.ETag,
      ),
    );
    for (const [key, value] of prior) {
      if (key.includes(`/snapshots/${VERSION_1}/`) || key.endsWith("/index.html")) {
        assert.deepEqual(s3.objects.get(key), value);
      }
    }
    const marker = s3.events.findIndex(
      ([event, key]) => event === "PUT_START" && key.endsWith("/out.json"),
    );
    assert.ok(
      s3.events
        .slice(0, marker)
        .some(([event, key]) => event === "PUT_DONE" && key.includes(`/snapshots/${VERSION_2}/`)),
    );
    assert.equal(
      s3.objects.get(`${BUCKET}/${COMMIT}/out.json`).head.Metadata["diveday-snapshot-version"],
      VERSION_2,
    );
  } finally {
    old.cleanup();
    current.cleanup();
  }
});

test("a same-owner legacy marker is replaced without touching legacy flat assets", async () => {
  const f = fixture();
  try {
    const legacy = storedObject({
      key: `${COMMIT}/out.json`,
      bytes: gzipSync(
        JSON.stringify({
          actualDir: "actual",
          expectedDir: "expected",
          diffDir: "diff",
          actualItems: ["capture.png"],
        }),
      ),
      contentType: "application/json",
      prNumber: PR,
    });
    legacy.head.Metadata["diveday-size"] = String(legacy.bytes.length);
    legacy.head.Metadata["diveday-sha256"] = digest(legacy.bytes);
    const flatKey = `${BUCKET}/${COMMIT}/actual/capture.png`;
    const initial = new Map([
      [`${BUCKET}/${COMMIT}/out.json`, legacy],
      [
        flatKey,
        storedObject({ key: flatKey, bytes: gzipSync("legacy image"), contentType: "image/png" }),
      ],
      [
        `${BUCKET}/${COMMIT}/index.html`,
        storedObject({
          key: `${COMMIT}/index.html`,
          bytes: f.entries.find((entry) => entry.key === "index.html").gz,
          contentType: "text/html",
        }),
      ],
    ]);
    const s3 = fakeS3({ initial });
    const result = await publishBundle(args(f, s3));
    assert.equal(result.status, "replaced");
    assert.equal(s3.objects.get(flatKey).bytes.toString(), gzipSync("legacy image").toString());
    assert.equal(
      s3.objects.get(`${BUCKET}/${COMMIT}/out.json`).head.Metadata["diveday-snapshot-version"],
      VERSION_1,
    );
  } finally {
    f.cleanup();
  }
});

test("cross-owner marker is refused before any upload", async () => {
  const f = fixture();
  try {
    const foreign = mapFromFixture(f, { prNumber: "3180" });
    const s3 = fakeS3({ initial: foreign });
    await assert.rejects(publishBundle(args(f, s3)), /ownership mismatch/u);
    assert.equal(
      s3.events.some(([event]) => event === "PUT_START"),
      false,
    );
  } finally {
    f.cleanup();
  }
});

test("same-version mismatch fails closed after byte verification", async () => {
  const f = fixture();
  try {
    const initial = mapFromFixture(f);
    const key = `${BUCKET}/${COMMIT}/snapshots/${VERSION_1}/actual/capture.png`;
    const stored = initial.get(key);
    stored.bytes = Buffer.from(gzipSync("corrupt capture"));
    const { ChecksumSHA256: _checksum, ...rest } = stored.head;
    stored.head = { ...rest, ChecksumCRC64NVME: "crc64-only" };
    const s3 = fakeS3({ initial });
    await assert.rejects(publishBundle(args(f, s3)), /provenance mismatch/u);
    assert.equal(
      s3.events.some(([event]) => event === "PUT_START"),
      false,
    );
    assert.ok(s3.events.some(([event, requestedKey]) => event === "GET" && requestedKey === key));
  } finally {
    f.cleanup();
  }
});

test("markerless partial version with a mismatched existing object is not overwritten", async () => {
  const f = fixture();
  try {
    const initial = mapFromFixture(f);
    initial.delete(`${BUCKET}/${COMMIT}/out.json`);
    const key = `${BUCKET}/${COMMIT}/snapshots/${VERSION_1}/actual/capture.png`;
    const stored = initial.get(key);
    stored.bytes = gzipSync("stale partial");
    const { ChecksumSHA256: _checksum, ...rest } = stored.head;
    stored.head = { ...rest, ChecksumCRC64NVME: "crc64-only" };
    const s3 = fakeS3({ initial });
    await assert.rejects(publishBundle(args(f, s3)), /immutable snapshot provenance mismatch/u);
    assert.equal(
      s3.events.some(([event, requestedKey]) => event === "PUT_START" && requestedKey === key),
      true,
    );
    assert.equal(
      s3.events.some(([event, requestedKey]) => event === "PUT_DONE" && requestedKey === key),
      false,
    );
    assert.equal(s3.objects.has(`${BUCKET}/${COMMIT}/out.json`), false);
  } finally {
    f.cleanup();
  }
});

test("409 conditional conflict retries once and exact 412 content is verified", async () => {
  const f = fixture();
  try {
    const key = `${BUCKET}/${COMMIT}/snapshots/${VERSION_1}/actual/capture.png`;
    const s3 = fakeS3({ conflictOnceKey: key });
    const result = await publishBundle(args(f, s3));
    assert.equal(result.status, "published");
    assert.equal(
      s3.events.filter(([event, requestedKey]) => event === "PUT_START" && requestedKey === key)
        .length,
      2,
    );
    assert.ok(
      s3.events.some(([event, requestedKey]) => event === "REMOTE_PUT" && requestedKey === key),
    );
    assert.ok(s3.events.some(([event, requestedKey]) => event === "HEAD" && requestedKey === key));
    assert.equal(s3.events.at(-1)[1], `${BUCKET}/${COMMIT}/out.json`);
  } finally {
    f.cleanup();
  }
});

test("marker compare-and-swap loss fails closed and preserves the concurrent marker", async () => {
  const old = fixture({ version: VERSION_1 });
  const current = fixture({ version: VERSION_2, capture: "capture two" });
  try {
    const s3 = fakeS3();
    await publishBundle(args(old, s3));
    const oldMarker = s3.objects.get(`${BUCKET}/${COMMIT}/out.json`);
    const competitor = storedObject({
      key: `${COMMIT}/out.json`,
      bytes: gzipSync(
        JSON.stringify({
          actualDir: `snapshots/${VERSION_3}/actual`,
          expectedDir: `snapshots/${VERSION_3}/expected`,
          diffDir: `snapshots/${VERSION_3}/diff`,
          actualItems: ["capture.png"],
        }),
      ),
      contentType: "application/json",
      snapshotVersion: VERSION_3,
    });
    const s3Race = fakeS3({
      initial: s3.objects,
      onPut: async ({ key, objects }) => {
        if (
          key === `${BUCKET}/${COMMIT}/out.json` &&
          objects.get(key).head.ETag === oldMarker.head.ETag
        ) {
          objects.set(key, competitor);
        }
      },
    });
    await assert.rejects(
      publishBundle(args(current, s3Race, { snapshotVersion: VERSION_2 })),
      /marker changed during publication/u,
    );
    assert.equal(
      s3Race.objects.get(`${BUCKET}/${COMMIT}/out.json`).head.Metadata["diveday-snapshot-version"],
      VERSION_3,
    );
    assert.equal(
      s3Race.events.filter(([event, key]) => event === "PUT_START" && key.endsWith("/out.json"))
        .length,
      1,
    );
  } finally {
    old.cleanup();
    current.cleanup();
  }
});

test("absent-marker 412 is accepted only when the winning marker selects this exact bundle", async () => {
  const f = fixture();
  const competitor = mapFromFixture(f).get(`${BUCKET}/${COMMIT}/out.json`);
  try {
    const s3 = fakeS3({
      onPut: async ({ key, objects }) => {
        if (key === `${BUCKET}/${COMMIT}/out.json` && !objects.has(key))
          objects.set(key, competitor);
      },
    });
    const result = await publishBundle(args(f, s3));
    assert.equal(result.status, "provenance-verified");
    assert.equal(
      s3.events.filter(([event, key]) => event === "PUT_START" && key.endsWith("/out.json")).length,
      1,
    );
  } finally {
    f.cleanup();
  }
});

const invalidBundleCases = [
  {
    name: "foreign snapshot prefix",
    edit: (text) => text.replace(`snapshots/${VERSION_1}/actual`, `snapshots/${VERSION_2}/actual`),
  },
  {
    name: "path traversal",
    edit: (text) =>
      text.replace(
        `snapshots/${VERSION_1}/actual/capture.png`,
        `snapshots/${VERSION_1}/actual/../escape.png`,
      ),
  },
  { name: "duplicate key", edit: (text) => `${text}${text.split("\n")[0]}\n` },
  {
    name: "unsupported root key",
    edit: (text) => `${text}arbitrary.js\tapplication/javascript\n`,
  },
];

test.each(invalidBundleCases)(
  "bundle validation rejects $name before S3 is called",
  async (item) => {
    const f = fixture();
    try {
      const manifest = readFileSync(path.join(f.bundle, "manifest.tsv"), "utf8");
      writeFileSync(path.join(f.bundle, "manifest.tsv"), item.edit(manifest));
      const s3 = fakeS3();
      await assert.rejects(publishBundle(args(f, s3)));
      assert.equal(s3.events.length, 0);
    } finally {
      f.cleanup();
    }
  },
);

test("request timeout and caller cancellation abort the S3 call", async () => {
  const f = fixture();
  try {
    const hanging = fakeS3({ hangHeadKey: `${BUCKET}/${COMMIT}/out.json` });
    await assert.rejects(
      publishBundle(args(f, hanging, { requestTimeoutMs: 10 })),
      /timed out|abort/i,
    );

    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    const cancelled = fakeS3();
    await assert.rejects(
      publishBundle(args(f, cancelled, { signal: controller.signal })),
      /caller cancelled/u,
    );
    assert.equal(cancelled.events.length, 0);
  } finally {
    f.cleanup();
  }
});

test("cancellation during bundle preflight sends no S3 requests", async () => {
  const f = fixture();
  try {
    const s3 = fakeS3();
    const controller = new AbortController();
    await assert.rejects(
      publishBundle(
        args(f, s3, {
          signal: controller.signal,
          onEvent: (event) => {
            if (event === "preflight-chunk")
              controller.abort(new Error("cancelled during preflight"));
          },
        }),
      ),
      /cancelled during preflight/u,
    );
    assert.equal(s3.events.length, 0);
  } finally {
    f.cleanup();
  }
});

test("a hanging checksum fallback body is destroyed when its request deadline expires", async () => {
  const f = fixture();
  try {
    const initial = mapFromFixture(f, { checksumPresent: false });
    const key = `${BUCKET}/${COMMIT}/snapshots/${VERSION_1}/actual/capture.png`;
    const s3 = fakeS3({ initial, hangGetKey: key });
    await assert.rejects(publishBundle(args(f, s3, { requestTimeoutMs: 10 })), /timed out|abort/i);
    assert.ok(s3.events.some(([event, requestedKey]) => event === "GET" && requestedKey === key));
  } finally {
    f.cleanup();
  }
});

test("versioned report directory metadata must agree with the supplied version", async () => {
  const f = fixture();
  try {
    const reportEntry = f.entries.find((entry) => entry.key === "out.json");
    const report = JSON.parse(reportEntry.bytes.toString("utf8"));
    report.actualDir = "actual";
    reportEntry.bytes = Buffer.from(JSON.stringify(report));
    reportEntry.gz = gzipSync(reportEntry.bytes, { level: 9, mtime: 0 });
    writeFileSync(path.join(f.bundle, "payload", "out.json.gz"), reportEntry.gz);
    const s3 = fakeS3();
    await assert.rejects(
      publishBundle(args(f, s3)),
      /does not describe the requested snapshot version/u,
    );
    assert.equal(s3.events.length, 0);
  } finally {
    f.cleanup();
  }
});

function httpResponse(statusCode, headers, body) {
  return { statusCode, headers, body };
}

function httpError(statusCode, code) {
  return httpResponse(
    statusCode,
    { "content-type": "application/xml", "x-amz-request-id": "mock-request" },
    Readable.from([
      Buffer.from(
        `<Error><Code>${code}</Code><Message>${code}</Message><RequestId>mock-request</RequestId></Error>`,
      ),
    ]),
  );
}

function sdkTransport() {
  const objects = new Map();
  const requests = [];
  const handler = {
    async handle(request, { abortSignal } = {}) {
      if (abortSignal?.aborted) throw abortSignal.reason;
      const url = new URL(request.path, "http://s3.test");
      const pathParts = url.pathname.split("/").filter(Boolean);
      const bucket = pathParts.shift();
      const key = decodeURIComponent(pathParts.join("/"));
      const headers = Object.fromEntries(
        Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
      );
      requests.push({ method: request.method, bucket, key, headers });
      const current = objects.get(`${bucket}/${key}`);
      if (request.method === "HEAD") {
        if (!current) return { response: httpError(404, "NotFound") };
        return {
          response: httpResponse(200, current.httpHeaders, Readable.from([])),
        };
      }
      if (request.method === "GET") {
        if (!current) return { response: httpError(404, "NoSuchKey") };
        if (headers["if-match"] !== current.httpHeaders.etag)
          return { response: httpError(412, "PreconditionFailed") };
        return {
          response: httpResponse(200, current.httpHeaders, Readable.from([current.bytes])),
        };
      }
      if (request.method !== "PUT") throw new Error(`unexpected SDK wire method ${request.method}`);
      if (headers["if-none-match"] === "*" && current)
        return { response: httpError(412, "PreconditionFailed") };
      if (headers["if-match"] && (!current || headers["if-match"] !== current.httpHeaders.etag)) {
        return { response: httpError(412, "PreconditionFailed") };
      }
      const chunks = [];
      if (request.body && typeof request.body[Symbol.asyncIterator] === "function") {
        for await (const chunk of request.body) chunks.push(Buffer.from(chunk));
      } else if (request.body) chunks.push(Buffer.from(request.body));
      const bytes = Buffer.concat(chunks);
      const sha = checksum(bytes);
      assert.equal(headers["x-amz-checksum-sha256"], sha);
      const etag = `"${digest(bytes).slice(0, 32)}"`;
      const meta = Object.fromEntries(
        Object.entries(headers)
          .filter(([name]) => name.startsWith("x-amz-meta-"))
          .map(([name, value]) => [name.slice("x-amz-meta-".length), value]),
      );
      const httpHeaders = {
        etag,
        "content-length": String(bytes.length),
        "content-type": headers["content-type"],
        "content-encoding": headers["content-encoding"],
        "x-amz-checksum-sha256": sha,
        "x-amz-meta-diveday-sha256": meta["diveday-sha256"],
        "x-amz-meta-diveday-size": meta["diveday-size"],
        "x-amz-meta-diveday-pr-number": meta["diveday-pr-number"],
      };
      if (meta["diveday-snapshot-version"]) {
        httpHeaders["x-amz-meta-diveday-snapshot-version"] = meta["diveday-snapshot-version"];
      }
      objects.set(`${bucket}/${key}`, { bytes, httpHeaders });
      return {
        response: httpResponse(200, { etag, "x-amz-checksum-sha256": sha }, Readable.from([])),
      };
    },
    destroy() {},
  };
  return { objects, requests, handler };
}

test("locked AWS SDK signs conditional writes and If-Match checksum reads on the wire", async () => {
  const old = fixture({ version: VERSION_1 });
  const current = fixture({ version: VERSION_2, capture: "capture two" });
  const transport = sdkTransport();
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "http://s3.test",
    forcePathStyle: true,
    credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" },
    requestHandler: transport.handler,
    maxAttempts: 1,
  });
  const commands = { HeadObjectCommand, GetObjectCommand, PutObjectCommand };
  try {
    await publishBundle(args(old, client, { commands }));
    const originalMarkerEtag = transport.objects.get(`${BUCKET}/${COMMIT}/out.json`).httpHeaders
      .etag;
    await publishBundle(args(current, client, { commands, snapshotVersion: VERSION_2 }));
    const markerRequests = transport.requests.filter(
      (request) => request.method === "PUT" && request.key === `${COMMIT}/out.json`,
    );
    assert.equal(markerRequests[0].headers["if-none-match"], "*");
    assert.equal(markerRequests[1].headers["if-match"], originalMarkerEtag);
    assert.ok(
      transport.requests
        .filter((request) => request.method === "PUT")
        .every((request) => request.headers["x-amz-checksum-sha256"]),
    );

    for (const [_key, value] of transport.objects) {
      delete value.httpHeaders["x-amz-checksum-sha256"];
    }
    transport.requests.length = 0;
    const retry = await publishBundle(
      args(current, client, { commands, snapshotVersion: VERSION_2 }),
    );
    assert.equal(retry.status, "provenance-verified");
    assert.equal(
      transport.requests.filter((request) => request.method === "GET").length,
      current.entries.length,
    );
    assert.ok(
      transport.requests
        .filter((request) => request.method === "GET")
        .every((request) => request.headers["if-match"]),
    );
    assert.ok(
      transport.requests
        .filter((request) => request.method === "HEAD")
        .every((request) => request.headers["x-amz-checksum-mode"] === "ENABLED"),
    );
  } finally {
    client.destroy();
    old.cleanup();
    current.cleanup();
  }
});
