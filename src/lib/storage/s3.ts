import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { nowDate } from "../clock";
import type { ImageStorageProvider, ImageUpload, StoredImage } from "./index";

const SERVICE = "s3";

export const s3StorageConfigSchema = z.object({
  bucket: z.string().trim().min(1),
  region: z.string().trim().min(1),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().trim().min(1),
  publicUrlBase: z.string().trim().url().optional(),
});

export type S3StorageConfig = z.infer<typeof s3StorageConfigSchema>;

function sha256Hex(data: ArrayBuffer | Buffer | Uint8Array | string): string {
  if (typeof data === "string") {
    return createHash("sha256").update(data, "utf8").digest("hex");
  }
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  return createHash("sha256").update(view).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function encodeS3KeyPath(key: string): string {
  return key.split("/").map(encodeRfc3986).join("/");
}

function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export function signS3Request(input: {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  payloadSha256Hex: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  now?: Date;
}): Record<string, string> {
  const now = input.now ?? nowDate();
  const dateTime = amzDate(now);
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

  const canonicalRequest = [
    input.method,
    input.url.pathname || "/",
    "",
    canonicalHeaders,
    signedHeaders,
    input.payloadSha256Hex,
  ].join("\n");

  const scope = `${date}/${input.region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, scope, sha256Hex(canonicalRequest)].join(
    "\n",
  );

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), SERVICE),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function safeName(filename: string): string {
  const cleaned = filename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "").slice(0, 80) || "image";
}

function toBlobBody(bytes: ArrayBuffer | Buffer): Blob {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return new Blob([copy]);
}

/** AWS S3 Image Storage Provider using native AWS SigV4 signed requests over fetch. */
export function s3ImageStorageProvider(
  config: S3StorageConfig,
  fetchImpl: typeof fetch = fetch,
): ImageStorageProvider {
  return {
    async upload(input: ImageUpload): Promise<StoredImage> {
      const suffix = randomBytes(16).toString("base64url");
      const key = `${input.keyPrefix}/${suffix}-${safeName(input.filename)}`;
      const s3Host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
      const url = new URL(`https://${s3Host}/${encodeS3KeyPath(key)}`);

      const payloadSha256Hex = sha256Hex(input.bytes);
      const signedHeaders = signS3Request({
        method: "PUT",
        url,
        headers: { "content-type": input.contentType },
        payloadSha256Hex,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        region: config.region,
      });

      try {
        const response = await fetchImpl(url, {
          method: "PUT",
          headers: signedHeaders,
          body: toBlobBody(input.bytes),
        });

        if (!response.ok) return { status: "failed" };

        const publicUrl = config.publicUrlBase
          ? `${config.publicUrlBase.replace(/\/+$/, "")}/${key}`
          : `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;

        return { status: "stored", url: publicUrl };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

/**
 * The origins an object of ours can be addressed by: the configured public
 * base (a CDN domain, once there is one) and the bucket's own REST endpoints.
 */
function configuredOrigins(config: S3StorageConfig): string[] {
  const origins = [
    `https://${config.bucket}.s3.${config.region}.amazonaws.com`,
    `https://${config.bucket}.s3.amazonaws.com`,
  ];
  if (config.publicUrlBase) {
    try {
      origins.push(new URL(config.publicUrlBase).origin);
    } catch {
      // Unparseable configuration; the bucket endpoints above still apply.
    }
  }
  return origins;
}

/**
 * Delete an object from S3 by URL using an AWS SigV4 signed DELETE request.
 *
 * The URL's own origin has to be one of ours. This used to take any URL, throw
 * the host away and use the path as a key in our bucket — so a URL a shop
 * merely *pasted* addressed an object it had never uploaded. Keys are
 * namespaced by content type rather than by shop (`courses/`, `import-waivers/`),
 * so that was a delete primitive over every other shop's media, and over the
 * imported waiver and receipt scans, with no row in the victim's own deletion
 * ledger to show for it.
 */
export async function deleteS3Image(
  url: string,
  config: S3StorageConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const parsedUrl = new URL(url);
    if (!configuredOrigins(config).includes(parsedUrl.origin)) {
      return { ok: false, error: "url is not on the configured media host" };
    }
    const key = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
    const s3Host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
    const deleteUrl = new URL(`https://${s3Host}/${encodeS3KeyPath(key)}`);

    const signedHeaders = signS3Request({
      method: "DELETE",
      url: deleteUrl,
      payloadSha256Hex: sha256Hex(""),
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
    });

    const response = await fetchImpl(deleteUrl, {
      method: "DELETE",
      headers: signedHeaders,
    });

    if (!response.ok && response.status !== 404) {
      return { ok: false, error: `provider responded ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown delete error" };
  }
}

/**
 * **Read one private object back out of the media bucket**, signed as the
 * uploader credential (issue #1283).
 *
 * The bucket blocks all public access and `medical-clearances/` has no
 * CloudFront behaviour by construction, so a stored physician's evaluation has
 * no URL anybody can fetch — which is the point, and which also meant the
 * upload bought retention liability with no retrieval value. This is the only
 * way back to those bytes, and it exists to be called by exactly one
 * permission-gated route.
 *
 * **Same origin proof as `deleteS3Image`.** The URL reaching this function
 * comes out of a database column, so a bad row must not become a row this
 * accepts. It is deliberately *not* an SSRF control: the request never goes to
 * the URL's own host, because the host is rebuilt below from `config.bucket`
 * and `config.region`. What the origin check decides is **which stored rows we
 * are willing to act on**, and nothing about where the request goes.
 *
 * That leaves `prefix` as the only control over *which object*, which is why
 * it is applied to the normalized path rather than to the key — see below. IAM
 * grants `s3:GetObject` on `medical-clearances/*` and nothing else, so a key
 * outside it would be refused by AWS anyway; the point of naming it here is
 * that the refusal is readable instead of arriving as a 403.
 */
export async function readS3Object(
  url: string,
  config: S3StorageConfig,
  options: { prefix: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; bytes: ArrayBuffer; contentType: string } | { ok: false; error: string }> {
  try {
    const parsedUrl = new URL(url);
    if (!configuredOrigins(config).includes(parsedUrl.origin)) {
      return { ok: false, error: "url is not on the configured media host" };
    }
    const key = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
    const s3Host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
    const getUrl = new URL(`https://${s3Host}/${encodeS3KeyPath(key)}`);
    // **Checked on the path that will actually be signed**, not on the key
    // before it. `signS3Request` signs `url.pathname`, and building a `URL`
    // folds dot segments — so a guard applied to the pre-normalized key can be
    // walked out of by encoding the *separators* rather than the dots:
    // `medical-clearances%2F..%2Fimport-waivers%2Fx.pdf` is one path segment to
    // the URL parser (nothing to fold), decodes to a key that starts with the
    // prefix, and then normalizes to `/import-waivers/x.pdf` on the way into
    // the signature. IAM refuses that today — `GetObject` is granted on this
    // prefix and no other — but a 403 nobody reads is exactly what naming the
    // prefix here was meant to replace.
    if (!getUrl.pathname.startsWith(`/${options.prefix}/`)) {
      return { ok: false, error: "url is not in the expected prefix" };
    }

    const signedHeaders = signS3Request({
      method: "GET",
      url: getUrl,
      payloadSha256Hex: sha256Hex(""),
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
    });

    const response = await fetchImpl(getUrl, { method: "GET", headers: signedHeaders });
    if (!response.ok) return { ok: false, error: `provider responded ${response.status}` };
    return {
      ok: true,
      bytes: await response.arrayBuffer(),
      // What S3 was told at upload, not what the caller guesses now. The
      // uploader re-encodes to JPEG or proves a real PDF by its magic bytes
      // before storing, so this value was established against the actual file.
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown read error" };
  }
}
