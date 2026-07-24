import { z } from "zod";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "./limits";
import { processImage } from "./process-image";

/**
 * The image-storage seam. Like the notification seam, the provider lives behind
 * one entry point so upload flows stay testable without real storage
 * credentials (ADR 20260718-card-image-storage). The stored value is a
 * provider-neutral durable URL, matching the `*_image_url` columns.
 *
 * Two callers, one seam: certification card photos, which are evidence, and
 * course page media, which is marketing. They share validation because the
 * bytes are the same problem; they keep separate key prefixes so a diver's card
 * never lands in the same namespace as a published brochure photo.
 */
export type StoredImage =
  | { status: "stored"; url: string }
  | { status: "not_configured" }
  | { status: "failed" };

export type ImageUpload = {
  /** Stable-ish key prefix, e.g. "cards"; a random suffix keeps names unique. */
  keyPrefix: string;
  filename: string;
  contentType: string;
  /** A `File`'s raw bytes on the way in; `processImage`'s re-encoded output on the way out. */
  bytes: ArrayBuffer | Buffer;
};

/** @deprecated Use `ImageUpload`; kept so card-capture call sites read unchanged. */
export type CardImageUpload = ImageUpload;

export interface ImageStorageProvider {
  upload(input: ImageUpload): Promise<StoredImage>;
}

export const MAX_CARD_IMAGE_BYTES = MAX_IMAGE_BYTES;
export const MAX_COURSE_IMAGE_BYTES = MAX_IMAGE_BYTES;
export const MAX_RECAP_IMAGE_BYTES = MAX_IMAGE_BYTES;
export const MAX_DIVE_SITE_IMAGE_BYTES = MAX_IMAGE_BYTES;
const ALLOWED_CONTENT_TYPES = new Set<string>(ALLOWED_IMAGE_CONTENT_TYPES);

type Fetch = typeof fetch;
type StorageEnvironment = Readonly<Record<string, string | undefined>>;

const blobConfigSchema = z.object({ token: z.string().trim().min(1) });
const blobResponseSchema = z.object({ url: z.string().url() });

/**
 * Vercel Blob's public object URLs always resolve under this suffix (a
 * per-store subdomain of `blob.vercel-storage.com`, distinct from the API
 * host `blob.vercel-storage.com` itself that `PUT`/`delete` calls target).
 * Used to tell a genuinely stored object apart from a URL that only *looks*
 * like one but was never written by this seam — a bundled template asset
 * (`/dive-sites/...`, root-relative — see `src/lib/courses.ts`) or a legacy
 * pasted external URL from before uploads existed. Queuing either of those
 * for provider deletion can never succeed: the provider has never heard of
 * them, so the delete would fail every retry forever (CR-012 review finding).
 */
const BLOB_PUBLIC_HOSTNAME_SUFFIX = ".public.blob.vercel-storage.com";

/** Whether `url` is an object this seam's own provider could plausibly have stored. */
export function isManagedBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(BLOB_PUBLIC_HOSTNAME_SUFFIX);
  } catch {
    return false;
  }
}

function safeName(filename: string): string {
  const cleaned = filename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "").slice(0, 80) || "card";
}

/** Every accepted upload is re-encoded to JPEG (`processImage`); keep the stored name honest. */
function withJpegExtension(filename: string): string {
  return `${filename.replace(/\.[a-z0-9]+$/i, "")}.jpg`;
}

/**
 * `fetch`'s `BodyInit` type wants a `Uint8Array<ArrayBuffer>` specifically; a
 * generically-backed `Uint8Array<ArrayBufferLike>` (which is what a `Buffer`
 * or a copy of one types as) doesn't structurally match. Wrapping in a `Blob`
 * sidesteps the generic mismatch — `Blob`'s constructor accepts any
 * `ArrayBufferView` regardless of its buffer's type parameter.
 */
function toBlobBody(bytes: ArrayBuffer | Buffer): Blob {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return new Blob([copy]);
}

/** Vercel Blob upload via its documented PUT API — no SDK dependency. */
export function vercelBlobStorageProvider(
  config: { token: string },
  fetchImpl: Fetch,
): ImageStorageProvider {
  return {
    async upload(input) {
      const suffix = Math.random().toString(36).slice(2, 10);
      const pathname = `${input.keyPrefix}/${suffix}-${safeName(input.filename)}`;
      try {
        const response = await fetchImpl(`https://blob.vercel-storage.com/${pathname}`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${config.token}`,
            "x-content-type": input.contentType,
            "x-add-random-suffix": "0",
          },
          body: toBlobBody(input.bytes),
        });
        if (!response.ok) return { status: "failed" };
        const body = blobResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed" };
        return { status: "stored", url: body.data.url };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

const disabledImageStorageProvider: ImageStorageProvider = {
  async upload() {
    return { status: "not_configured" };
  },
};

export function imageStorageProviderFromEnvironment(
  env: StorageEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): ImageStorageProvider {
  const config = blobConfigSchema.safeParse({ token: env.BLOB_READ_WRITE_TOKEN });
  return config.success
    ? vercelBlobStorageProvider(config.data, fetchImpl)
    : disabledImageStorageProvider;
}

export type DeleteImageResult = { ok: true } | { ok: false; error: string };

/**
 * Delete a stored blob by its URL, reporting whether it actually worked
 * (CR-012) — the primitive `queueAndAttemptMediaDeletion`
 * (src/db/media-deletions.ts) durably records and retries on top of. With no
 * token configured, deleting is trivially "successful": there is nothing
 * stored to leave behind.
 */
export async function deleteStoredImageTracked(
  url: string,
  env: StorageEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): Promise<DeleteImageResult> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { ok: true };
  try {
    const response = await fetchImpl("https://blob.vercel-storage.com/delete", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ urls: [url] }),
    });
    if (!response.ok) return { ok: false, error: `provider responded ${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown delete error" };
  }
}

/**
 * Best-effort delete of a stored blob by its URL — for cleaning up an object
 * that was written but then rejected downstream before anything ever
 * referenced it (e.g. a recap-photo upload that loses a race against the
 * per-booking cap: no row was ever created, so there is nothing for a
 * moderation queue to track). Deliberately swallows everything: a failed
 * cleanup must never surface to the diver whose upload otherwise succeeded.
 * Media a person or the shop deliberately removes goes through the tracked,
 * owner-visible queue instead (`queueAndAttemptMediaDeletion`,
 * src/db/media-deletions.ts) — this stays for that one narrower case.
 */
export async function deleteStoredImage(
  url: string,
  env: StorageEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  await deleteStoredImageTracked(url, env, fetchImpl);
}

/**
 * Validate and store a card image. Rejects a non-image or oversized file
 * before touching the provider; an unconfigured provider reports
 * not_configured so the caller can keep the card record without a photo.
 */
export async function storeCardImage(
  upload: ImageUpload,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  return storeImage(upload, MAX_CARD_IMAGE_BYTES, provider);
}

/**
 * Store a photo for a course page. Same validation as a card, its own key
 * prefix, and the caller decides what an unconfigured provider means — the
 * course editor keeps the page and reports that the photo did not upload.
 */
export async function storeCourseImage(
  upload: Omit<ImageUpload, "keyPrefix">,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  return storeImage({ ...upload, keyPrefix: "courses" }, MAX_COURSE_IMAGE_BYTES, provider);
}

/**
 * Store a diver's post-trip recap photo. Same validation as the others, its own
 * `recap` key prefix so diver snapshots never share a namespace with evidence
 * or brochure media; the caller keeps the recap page working whether or not a
 * provider is configured.
 */
export async function storeRecapImage(
  upload: Omit<ImageUpload, "keyPrefix">,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  return storeImage({ ...upload, keyPrefix: "recap" }, MAX_RECAP_IMAGE_BYTES, provider);
}

/**
 * Store a dive-site briefing photo (satellite/route/gallery). Same
 * validation as the others, its own `dive-sites` key prefix. The only
 * caller is `src/lib/storage/ingest-url.ts` (CR-020) — a staff-pasted
 * third-party URL is fetched once server-side and re-stored here rather
 * than rendered directly, so public dive-site pages never make a live
 * request to a host outside this app.
 */
export async function storeDiveSiteImage(
  upload: Omit<ImageUpload, "keyPrefix">,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  return storeImage({ ...upload, keyPrefix: "dive-sites" }, MAX_DIVE_SITE_IMAGE_BYTES, provider);
}

async function storeImage(
  upload: ImageUpload,
  maxBytes: number,
  provider: ImageStorageProvider,
): Promise<StoredImage> {
  // Cheap first gate on the caller's claim, before spending CPU on a real
  // decode: an obviously wrong content-type or size is rejected here.
  if (!ALLOWED_CONTENT_TYPES.has(upload.contentType)) return { status: "failed" };
  if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > maxBytes) {
    return { status: "failed" };
  }
  // The authoritative check (CR-012): decode the actual bytes, validate the
  // real format/dimensions, strip metadata, and re-encode before any of it
  // reaches the provider. A disguised or malformed file is rejected here
  // regardless of what it claimed to be above.
  const processed = await processImage(upload.bytes);
  if (!processed.ok) return { status: "failed" };
  return provider.upload({
    ...upload,
    filename: withJpegExtension(upload.filename),
    contentType: processed.contentType,
    bytes: processed.bytes,
  });
}
