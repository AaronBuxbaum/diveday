import { z } from "zod";

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
  bytes: ArrayBuffer;
};

/** @deprecated Use `ImageUpload`; kept so card-capture call sites read unchanged. */
export type CardImageUpload = ImageUpload;

export interface ImageStorageProvider {
  upload(input: ImageUpload): Promise<StoredImage>;
}

export const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_COURSE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

type Fetch = typeof fetch;
type StorageEnvironment = Readonly<Record<string, string | undefined>>;

const blobConfigSchema = z.object({ token: z.string().trim().min(1) });
const blobResponseSchema = z.object({ url: z.string().url() });

function safeName(filename: string): string {
  const cleaned = filename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "").slice(0, 80) || "card";
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
          body: input.bytes,
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

async function storeImage(
  upload: ImageUpload,
  maxBytes: number,
  provider: ImageStorageProvider,
): Promise<StoredImage> {
  if (!ALLOWED_CONTENT_TYPES.has(upload.contentType)) return { status: "failed" };
  if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > maxBytes) {
    return { status: "failed" };
  }
  return provider.upload(upload);
}
