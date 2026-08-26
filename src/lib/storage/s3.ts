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

/** Delete an object from S3 by URL using AWS SigV4 signed DELETE request. */
export async function deleteS3Image(
  url: string,
  config: S3StorageConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const parsedUrl = new URL(url);
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
