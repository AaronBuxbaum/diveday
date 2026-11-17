import { randomBytes } from "node:crypto";
import { managedStorageOrigins } from "./blob-host";
import { mediaStorageConfigFromEnvironment } from "./index";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "./limits";
import { processImage } from "./process-image";
import { type S3StorageConfig, signS3Request } from "./s3";
import { sha256S3Payload } from "./s3-signing";

const PREFIX = "private-person-photos";
const KEY_PATH = /^\/private-person-photos\/[A-Za-z0-9_-]{22}\.jpg$/;
const ALLOWED_TYPES = new Set<string>(ALLOWED_IMAGE_CONTENT_TYPES);
const PUT_TIMEOUT_MS = 30_000;

type Environment = Readonly<Record<string, string | undefined>>;
type PhotoUpload = { filename: string; contentType: string; bytes: ArrayBuffer | Buffer };

type Options = { env?: Environment; fetchImpl?: typeof fetch };

/**
 * Allocate before making any network request. The caller must durably record the
 * returned URL before issuing a PUT: even a refused or timed-out PUT can leave
 * an object at that key. Never derive a key from the supplied filename.
 */
export function allocatePrivatePersonPhoto(env: Environment = process.env): { url: string } | null {
  const parsed = mediaStorageConfigFromEnvironment(env);
  if (!parsed.success) return null;
  const origin = bucketOrigin(parsed.data, env);
  if (!origin) return null;
  return { url: `${origin}/${PREFIX}/${randomBytes(16).toString("base64url")}.jpg` };
}

function bucketOrigin(config: S3StorageConfig, env: Environment): string | null {
  const candidate = `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
  // The same origin validation used by deletion; never splice an unchecked
  // bucket or region into a signed request.
  return managedStorageOrigins(env).includes(candidate) ? candidate : null;
}

/**
 * Write exactly the preallocated key, never a caller-selected destination. A
 * An uncertain result means a PUT was attempted and the caller must retain its
 * cleanup obligation: S3 may finish after the client loses its response.
 * Rejected means validation failed before any PUT was attempted.
 */
export async function uploadPrivatePersonPhoto(
  url: string,
  file: PhotoUpload,
  options: Options = {},
): Promise<"stored" | "rejected" | "uncertain"> {
  const env = options.env ?? process.env;
  const parsed = mediaStorageConfigFromEnvironment(env);
  if (!parsed.success) return "rejected";
  const origin = bucketOrigin(parsed.data, env);
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return "rejected";
  }
  if (
    !origin ||
    target.origin !== origin ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !KEY_PATH.test(target.pathname)
  )
    return "rejected";
  if (
    !ALLOWED_TYPES.has(file.contentType) ||
    file.bytes.byteLength === 0 ||
    file.bytes.byteLength > MAX_IMAGE_BYTES
  )
    return "rejected";
  const processed = await processImage(file.bytes);
  if (!processed.ok) return "rejected";
  const headers = signS3Request({
    method: "PUT",
    url: target,
    headers: { "content-type": processed.contentType },
    payloadSha256Hex: sha256S3Payload(processed.bytes),
    accessKeyId: parsed.data.accessKeyId,
    secretAccessKey: parsed.data.secretAccessKey,
    region: parsed.data.region,
  });
  const bytes = new Uint8Array(processed.bytes.length);
  bytes.set(processed.bytes);
  try {
    const response = await (options.fetchImpl ?? fetch)(target, {
      method: "PUT",
      headers,
      body: new Blob([bytes]),
      signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
    });
    return response.ok ? "stored" : "uncertain";
  } catch {
    return "uncertain";
  }
}
