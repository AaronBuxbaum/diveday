import { createHash, createHmac } from "node:crypto";

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

const SERVICE = "s3";

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * RFC 3986 encoding as SigV4 demands it: everything but unreserved characters
 * is percent-encoded, uppercase hex. `encodeURIComponent` gets close; the four
 * characters it leaves bare (`!'()*`) must still be encoded.
 */
function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A key's canonical URI path: each slash-separated segment encoded once. */
export function encodeS3KeyPath(key: string): string {
  return key.split("/").map(encodeRfc3986).join("/");
}

/** "20260804T060000Z" — SigV4's basic-format timestamp. */
function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

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
  const dateTime = amzDate(input.now);
  const date = dateTime.slice(0, 8);

  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value.trim(),
      ]),
    ),
    host: input.url.host,
    "x-amz-content-sha256": input.payloadSha256Hex,
    "x-amz-date": dateTime,
  };

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  // The pathname arrives already segment-encoded by the URL/`encodeS3KeyPath`;
  // signing it as-is keeps the signature over exactly the bytes sent.
  const canonicalRequest = [
    input.method,
    input.url.pathname || "/",
    "", // canonical query string — always empty here
    canonicalHeaders,
    signedHeaders,
    input.payloadSha256Hex,
  ].join("\n");

  const scope = `${date}/${input.region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, scope, sha256Hex(canonicalRequest)].join(
    "\n",
  );

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, date), input.region), SERVICE),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
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
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** PUT one object. Never throws — every failure is a code the caller records. */
export async function putS3Object(input: PutObjectInput): Promise<PutObjectResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.endpoint.replace(/\/+$/, "");
  const url = new URL(`${base}/${encodeRfc3986(input.bucket)}/${encodeS3KeyPath(input.key)}`);

  const headers = signS3Request({
    method: "PUT",
    url,
    headers: { "content-type": input.contentType },
    payloadSha256Hex: sha256Hex(input.body),
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
