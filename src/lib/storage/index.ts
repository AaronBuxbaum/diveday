import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, PDF_CONTENT_TYPE } from "./limits";
import { processImage } from "./process-image";

/**
 * The image-storage seam. Like the notification seam, the provider lives behind
 * one entry point so upload flows stay testable without real storage
 * credentials. The stored value is a provider-neutral durable URL, matching
 * the `*_image_url` / `*_url` columns.
 *
 * Callers share validation because the bytes are the same problem (re-encoding,
 * EXIF stripping, size caps); they keep separate key prefixes so public brochure
 * photos, shop logos, diver recap memories, and imported archival scans never
 * land in the same namespace. (Certification card uploads were retired in ADR
 * 20260811-retire-the-digital-card.)
 */
export type StoredImage =
  | { status: "stored"; url: string }
  | { status: "not_configured" }
  | { status: "failed" };

export type ImageUpload = {
  /** Stable-ish key prefix, e.g. "courses", "recap"; a random suffix keeps names unique. */
  keyPrefix: string;
  filename: string;
  contentType: string;
  /** A `File`'s raw bytes on the way in; `processImage`'s re-encoded output on the way out. */
  bytes: ArrayBuffer | Buffer;
};

export interface ImageStorageProvider {
  upload(input: ImageUpload): Promise<StoredImage>;
}

export const MAX_COURSE_IMAGE_BYTES = MAX_IMAGE_BYTES;
export const MAX_RECAP_IMAGE_BYTES = MAX_IMAGE_BYTES;
export const MAX_DIVE_SITE_IMAGE_BYTES = MAX_IMAGE_BYTES;
export const MAX_SHOP_LOGO_BYTES = MAX_IMAGE_BYTES;
const ALLOWED_CONTENT_TYPES = new Set<string>(ALLOWED_IMAGE_CONTENT_TYPES);

type Fetch = typeof fetch;
type StorageEnvironment = Readonly<Record<string, string | undefined>>;

const blobConfigSchema = z.object({ token: z.string().trim().min(1) });
const blobResponseSchema = z.object({ url: z.string().url() });

/**
 * Re-exported so existing callers (`./ingest-url.ts`, `@/lib/storage`
 * importers) keep working unchanged. Lives in its own file, with no
 * server-only imports, so a "use client" component can import it directly
 * without pulling in `sharp` via this module's `process-image.ts` import
 * (CR-011) — see `./blob-host.ts` for the implementation and rationale.
 */
export { isManagedBlobUrl } from "./blob-host";

function safeName(filename: string): string {
  const cleaned = filename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "").slice(0, 80) || "image";
}

/** Every accepted upload is re-encoded to JPEG (`processImage`); keep the stored name honest. */
function withJpegExtension(filename: string): string {
  return `${filename.replace(/\.[a-z0-9]+$/i, "")}.jpg`;
}

/** A PDF import document is stored as-is; keep the stored name's extension honest. */
function withPdfExtension(filename: string): string {
  return `${filename.replace(/\.[a-z0-9]+$/i, "")}.pdf`;
}

/**
 * `%PDF-` — the authoritative signature at the head of every PDF. We route on
 * the actual bytes, not the caller's content-type claim, so a mislabeled or
 * disguised file can never take the PDF path (and a real PDF always does,
 * whatever header the source sent).
 */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

function looksLikePdf(bytes: ArrayBuffer | Buffer): boolean {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.length >= PDF_MAGIC.length && PDF_MAGIC.every((byte, i) => view[i] === byte);
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
      const suffix = randomBytes(16).toString("base64url");
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
 * Store a photo for a course page. Same validation as other images, its own
 * "courses" key prefix, and the caller decides what an unconfigured provider
 * means — the course editor keeps the page and reports that the photo did not upload.
 */
export async function storeCourseImage(
  upload: Omit<ImageUpload, "keyPrefix">,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  return storeImage({ ...upload, keyPrefix: "courses" }, MAX_COURSE_IMAGE_BYTES, provider);
}

/**
 * Store a diver's post-trip recap photo. Same validation as the others, its own
 * `recap` key prefix so diver snapshots never share a namespace with marketing
 * or imported media; the caller keeps the recap page working whether or not a
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

/**
 * Store a dive shop's brand logo.
 */
export async function storeShopLogoImage(
  upload: Omit<ImageUpload, "keyPrefix">,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  return storeImage({ ...upload, keyPrefix: "shop-logos" }, MAX_SHOP_LOGO_BYTES, provider);
}

/**
 * Store a contact-import waiver or medical document scan. Its own
 * `import-waivers` key prefix so imported evidence never shares a namespace with
 * a brochure, shop logo, or diver's own recap photo. Only called from the
 * server-side commit path (`src/db/import.ts`), on a URL a staff member pasted
 * into an import row — never rendered from that raw URL directly (ADR
 * 20260724-import-waiver-acceptance).
 *
 * Two shapes are accepted (ADR 20260724-import-verified-cards). An **image**
 * takes the same decode-strip-re-encode path as every other upload. A **PDF**
 * (identified by its `%PDF-` magic bytes, not the caller's content-type claim)
 * is stored as-is: the `sharp` pipeline can't decode a PDF, and an import
 * document is archival evidence that is never rendered from its raw bytes, so
 * re-encoding it would be both impossible and pointless. Anything that is
 * neither a valid image nor a real PDF is rejected.
 */
export async function storeImportWaiverDocument(
  upload: Omit<ImageUpload, "keyPrefix">,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  const scoped = { ...upload, keyPrefix: "import-waivers" };
  if (looksLikePdf(upload.bytes)) {
    return storePdfDocument(scoped, MAX_IMAGE_BYTES, provider);
  }
  return storeImage(scoped, MAX_IMAGE_BYTES, provider);
}

/**
 * Store a receipt document supplied by a contact import. This follows the
 * exact same byte validation and re-storage path as imported waiver evidence,
 * but its `import-receipts` namespace keeps financial source documents out of
 * waiver and public-media storage. The caller is server-side and never
 * renders the source URL directly.
 */
export async function storeImportReceiptDocument(
  upload: Omit<ImageUpload, "keyPrefix">,
  provider: ImageStorageProvider = imageStorageProviderFromEnvironment(),
): Promise<StoredImage> {
  const scoped = { ...upload, keyPrefix: "import-receipts" };
  if (looksLikePdf(upload.bytes)) {
    return storePdfDocument(scoped, MAX_IMAGE_BYTES, provider);
  }
  return storeImage(scoped, MAX_IMAGE_BYTES, provider);
}

/**
 * Store a PDF import document without the image pipeline. The bytes are already
 * bounded by the ingest fetch (`ingestImageUrl`, which enforces the same
 * `MAX_IMAGE_BYTES` cap and all the SSRF defenses); here we re-check the size
 * and confirm the `%PDF-` signature before handing the raw bytes to the
 * provider with an honest `application/pdf` content-type and `.pdf` name.
 */
async function storePdfDocument(
  upload: ImageUpload,
  maxBytes: number,
  provider: ImageStorageProvider,
): Promise<StoredImage> {
  if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > maxBytes) {
    return { status: "failed" };
  }
  if (!looksLikePdf(upload.bytes)) return { status: "failed" };
  return provider.upload({
    ...upload,
    filename: withPdfExtension(upload.filename),
    contentType: PDF_CONTENT_TYPE,
  });
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
