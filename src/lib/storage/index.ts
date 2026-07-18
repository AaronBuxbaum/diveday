import { z } from "zod";

/**
 * The image-storage seam for certification card photos. Like the notification
 * seam, the provider lives behind one entry point so capture flows stay
 * testable without real storage credentials (ADR 20260718-card-image-storage).
 * The stored value is a provider-neutral durable URL, matching the existing
 * `card_image_url` columns.
 */
export type StoredImage =
  | { status: "stored"; url: string }
  | { status: "not_configured" }
  | { status: "failed" };

export type CardImageUpload = {
  /** Stable-ish key prefix, e.g. "cards"; a random suffix keeps names unique. */
  keyPrefix: string;
  filename: string;
  contentType: string;
  bytes: ArrayBuffer;
};

export interface ImageStorageProvider {
  upload(input: CardImageUpload): Promise<StoredImage>;
}

export const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024;
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
 * before touching the provider; an unconfigured provider returns
 * not_configured so the caller can fall back to a pasted URL.
 */
export async function storeCardImage(
  upload: CardImageUpload,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  if (!ALLOWED_CONTENT_TYPES.has(upload.contentType)) return { status: "failed" };
  if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > MAX_CARD_IMAGE_BYTES) {
    return { status: "failed" };
  }
  return provider.upload(upload);
}
