import { publicOnlyFetch } from "@/lib/net/public-fetch";
import {
  encodeS3KeyPath,
  encodeS3KeySegment,
  sha256S3Payload,
  signS3RequestHeaders,
} from "@/lib/storage/s3-signing";

export { encodeS3KeyPath } from "@/lib/storage/s3-signing";

/**
 * A minimal S3-compatible client: AWS Signature Version 4 over `fetch`, PUT
 * only, path-style addressing. Hand-signed with `node:crypto` rather than
 * pulling in an SDK — the whole surface this feature needs is one signed
 * request, and the AWS SDK is a large runtime dependency with its own config
 * resolution (env vars, shared credential files, IMDS probing) that must never
 * run against a *shop's* credential (ADR 20260804-shop-owned-backup-export).
 *
 * Path-style (`https://endpoint/bucket/key`) rather than virtual-host style,
 * because it works unchanged across AWS S3, Cloudflare R2, Backblaze B2, and
 * MinIO without per-provider DNS assumptions.
 *
 * Correctness is pinned by AWS's published SigV4 example requests in
 * `s3-client.test.ts` — change the signing path only with those tests green.
 */

export type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type SignRequestInput = {
  method: string;
  /** Full request URL. The query string must be empty — this client never signs one. */
  url: URL;
  /** Extra headers to sign and send, beyond host/x-amz-date/x-amz-content-sha256. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the request payload (of the empty string for bodyless requests). */
  payloadSha256Hex: string;
  credentials: S3Credentials;
  region: string;
  now: Date;
};

/**
 * The signed header set for one request: everything passed in plus `host`,
 * `x-amz-date`, `x-amz-content-sha256`, and the derived `authorization`.
 * Pure — same inputs, same signature — which is what lets the AWS test
 * vectors assert it byte for byte.
 */
export function signS3Request(input: SignRequestInput): Record<string, string> {
  // The pathname arrives already segment-encoded; signing it as-is preserves
  // the exact path bytes sent by this caller.
  return signS3RequestHeaders({
    ...input,
    accessKeyId: input.credentials.accessKeyId,
    secretAccessKey: input.credentials.secretAccessKey,
  });
}

/**
 * Why an upload did not land, as a closed set of codes the UI translates
 * (ADR 20260731-domain-layer-copy-leaks). Deliberately coarse: the settings
 * page needs "fix your credentials" vs "fix your bucket" vs "unreachable",
 * not the provider's error prose — which this client never reads, because a
 * response body from a misconfigured endpoint is untrusted input.
 */
export type BackupUploadErrorCode =
  | "upload_unauthorized"
  | "bucket_not_found"
  | "upload_rejected"
  | "network_unreachable";

export type PutObjectResult = { ok: true } | { ok: false; errorCode: BackupUploadErrorCode };

const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * How the bucket is named in the request URL.
 *
 * - `path` (default) puts it in the path: `https://endpoint/bucket/key`. The
 *   portable choice, and the only one that works unchanged across Cloudflare
 *   R2, Backblaze B2 and MinIO, so it stays the default for the shop-owned
 *   destinations this client was built for.
 * - `virtual-hosted` puts it in the host: `https://bucket.endpoint-host/key`.
 *   What AWS S3 itself wants -- AWS has deprecated path-style addressing, and
 *   although it still answers such requests today, a *backup* is the last path
 *   that should depend on a deprecation staying unenforced.
 *
 * SigV4 needs no special handling either way: `signS3Request` reads `host` off
 * the URL it is given and signs the path as sent, so moving the bucket from one
 * to the other changes the canonical request correctly and automatically.
 */
export type S3Addressing = "path" | "virtual-hosted";

export type PutObjectInput = {
  /** HTTPS origin of the S3-compatible API, e.g. "https://<account>.r2.cloudflarestorage.com". */
  endpoint: string;
  region: string;
  bucket: string;
  /** Object key, un-encoded ("diveday/backup.zip"); encoded per segment here. */
  key: string;
  body: Uint8Array;
  contentType: string;
  credentials: S3Credentials;
  now: Date;
  addressing?: S3Addressing;
  /**
   * Tests only. The default is `publicOnlyFetch`, which refuses a private,
   * loopback or link-local address at connection time (issue #3267): the
   * endpoint's hostname passed `backupEndpointRefusal` when it was saved, but
   * what it resolves to is the DNS owner's choice, then and on every upload.
   */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** The request URL for one object under the chosen addressing style. */
export function s3ObjectUrl(input: {
  endpoint: string;
  bucket: string;
  key: string;
  addressing?: S3Addressing;
}): URL {
  const base = input.endpoint.replace(/\/+$/, "");
  const encodedKey = encodeS3KeyPath(input.key);
  if (input.addressing !== "virtual-hosted") {
    return new URL(`${base}/${encodeS3KeySegment(input.bucket)}/${encodedKey}`);
  }
  // The bucket becomes a host label, so it is never percent-encoded: an S3
  // bucket name is already restricted to DNS-safe characters, and encoding one
  // would produce a host that does not resolve rather than a signing error.
  const url = new URL(base);
  url.host = `${input.bucket}.${url.host}`;
  url.pathname = `/${encodedKey}`;
  return url;
}

/**
 * PUT one object. Never throws — every failure is a code the caller records.
 * A refused private address is `network_unreachable`: the honest answer to
 * "why didn't it land" is that DiveDay would not reach that endpoint.
 */
export async function putS3Object(input: PutObjectInput): Promise<PutObjectResult> {
  const fetchImpl = input.fetchImpl ?? publicOnlyFetch();
  const url = s3ObjectUrl(input);

  const headers = signS3Request({
    method: "PUT",
    url,
    headers: { "content-type": input.contentType },
    payloadSha256Hex: sha256S3Payload(input.body),
    credentials: input.credentials,
    region: input.region,
    now: input.now,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "PUT",
      headers,
      body: input.body as BodyInit,
      signal: controller.signal,
      // Never follow a redirect: the endpoint is owner-configured, and a
      // redirecting "bucket" could bounce the signed PUT (body and all) at an
      // address the private-host check already refused. S3-compatible PUTs
      // have no legitimate redirect to follow — a 307 from AWS means the
      // endpoint/region is wrong, which is exactly an `upload_rejected`.
      redirect: "manual",
    });
    // The body is never read (it is untrusted prose); release the connection.
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, errorCode: "upload_unauthorized" };
    }
    if (response.status === 404) return { ok: false, errorCode: "bucket_not_found" };
    return { ok: false, errorCode: "upload_rejected" };
  } catch {
    return { ok: false, errorCode: "network_unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}
