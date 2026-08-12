import { MAX_SITE_IMAGES } from "@/lib/dive-sites";
import { storeDiveSiteImage } from "./index";

/**
 * The dive-site briefing's photos, as files a staffer picks.
 *
 * This replaced a paste-a-URL form. That form had to fetch every pasted link
 * server-side and re-store it (`ingestDiveSiteMedia`, CR-020) precisely because
 * a public dive-site page must never make a live request to a staff-chosen
 * third-party host — which would let that host watch every visitor's IP and
 * referrer. Uploading removes the round trip *and* the class of problem: the
 * bytes arrive from the staffer's own device and go straight to first-party
 * storage, so there is no external URL to fetch, no SSRF surface, and no link
 * that can quietly start pointing somewhere else after it was saved.
 *
 * It reads the form's own field names because those names *are* the contract
 * between `SiteFields` and the two pages that post it, and having one module
 * own both halves is what keeps the create and edit paths from drifting.
 */

/** The three photo inputs on the site form, by the names `SiteFields` renders. */
const FIELDS = {
  mapImage: "satelliteImageFile",
  routeImage: "routeImageFile",
  gallery: "siteImageFiles",
  removeMapImage: "removeSatelliteImage",
  removeRouteImage: "removeRouteImage",
  removeGallery: "removeSiteImageUrls",
} as const;

export type DiveSitePhotos = {
  satelliteImageUrl?: string;
  routeImageUrl?: string;
  imageUrls: string[];
};

export type DiveSitePhotoResult =
  | { ok: true; photos: DiveSitePhotos }
  | { ok: false; reason: "not_configured" | "rejected" };

/** What a site already holds, so an edit can keep, replace, or drop each photo. */
export type ExistingDiveSitePhotos = {
  satelliteImageUrl: string | null;
  routeImageUrl: string | null;
  imageUrls: string[];
};

type UploadOne = { ok: true; url?: string } | { ok: false; reason: "not_configured" | "rejected" };

/** Upload one picked file. An empty input is "nothing picked", never a failure. */
async function uploadOne(entry: FormDataEntryValue | null): Promise<UploadOne> {
  if (!(entry instanceof File) || entry.size === 0) return { ok: true, url: undefined };
  const stored = await storeDiveSiteImage({
    filename: entry.name,
    contentType: entry.type,
    bytes: await entry.arrayBuffer(),
  });
  if (stored.status === "stored") return { ok: true, url: stored.url };
  // "Not configured" is an operator gap (no Blob token on this deployment), not
  // a bad file — the form says something meaningfully different for each.
  return { ok: false, reason: stored.status === "not_configured" ? "not_configured" : "rejected" };
}

/**
 * Resolve one submitted site form's photos into the three columns.
 *
 * Fails the whole save rather than storing a briefing that is half the photos
 * the staffer picked: a partial upload is indistinguishable, on the next page
 * load, from photos they never chose.
 *
 * `existing` is the site as stored — omitted on the create form, where there is
 * nothing to keep. A picked file replaces; a ticked "remove" box clears; and
 * neither leaves the stored photo exactly as it was.
 */
export async function uploadDiveSitePhotos(
  formData: FormData,
  existing?: ExistingDiveSitePhotos,
): Promise<DiveSitePhotoResult> {
  const newGalleryFiles = formData
    .getAll(FIELDS.gallery)
    .filter((file): file is File => file instanceof File && file.size > 0);

  const removedGallery = new Set(formData.getAll(FIELDS.removeGallery).map(String));
  const keptGallery = (existing?.imageUrls ?? []).filter((url) => !removedGallery.has(url));
  // Checked before a single byte is uploaded: refusing after storing four
  // photos would leave orphaned objects nothing references.
  if (keptGallery.length + newGalleryFiles.length > MAX_SITE_IMAGES) {
    return { ok: false, reason: "rejected" };
  }

  const [mapImage, routeImage, ...gallery] = await Promise.all([
    uploadOne(formData.get(FIELDS.mapImage)),
    uploadOne(formData.get(FIELDS.routeImage)),
    ...newGalleryFiles.map((file) => uploadOne(file)),
  ]);

  const results = [mapImage, routeImage, ...gallery];
  const failure = results.find((result): result is Extract<UploadOne, { ok: false }> => !result.ok);
  if (failure) {
    // One unconfigured deployment explains every failure in the batch, so it
    // wins over a per-file rejection when both are present.
    const unconfigured = results.some((result) => !result.ok && result.reason === "not_configured");
    return { ok: false, reason: unconfigured ? "not_configured" : failure.reason };
  }

  const keepOrDrop = (
    uploaded: string | undefined,
    removeField: string,
    stored: string | null | undefined,
  ) => uploaded ?? (formData.get(removeField) === "true" ? undefined : (stored ?? undefined));

  return {
    ok: true,
    photos: {
      satelliteImageUrl: keepOrDrop(
        mapImage.ok ? mapImage.url : undefined,
        FIELDS.removeMapImage,
        existing?.satelliteImageUrl,
      ),
      routeImageUrl: keepOrDrop(
        routeImage.ok ? routeImage.url : undefined,
        FIELDS.removeRouteImage,
        existing?.routeImageUrl,
      ),
      imageUrls: [
        ...keptGallery,
        ...gallery.map((image) => (image.ok ? image.url : undefined)).filter((url) => Boolean(url)),
      ] as string[],
    },
  };
}

/**
 * Blob objects this save orphaned — a replaced map or route still, a gallery
 * photo the staffer removed. The caller queues each through
 * `queueAndAttemptMediaDeletion` once the row is durably saved, never before:
 * the local change must not be blocked on storage (CR-012).
 */
export function supersededDiveSitePhotos(
  before: ExistingDiveSitePhotos,
  after: DiveSitePhotos,
): string[] {
  const stillReferenced = new Set(
    [after.satelliteImageUrl, after.routeImageUrl, ...after.imageUrls].filter(
      (url): url is string => Boolean(url),
    ),
  );
  return [before.satelliteImageUrl, before.routeImageUrl, ...before.imageUrls]
    .filter((url): url is string => Boolean(url))
    .filter((url) => !stillReferenced.has(url));
}
