import {
  type DiveSiteLandmark,
  landmarkPhotoField,
  MAX_SITE_LANDMARKS,
  parseDiveSiteLandmarks,
} from "@/lib/dive-site-landmarks";
import { MAX_SITE_IMAGES } from "@/lib/dive-sites";
import { safeJson } from "@/lib/safe-json";
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
  landmarks: "landmarks",
} as const;

export type DiveSitePhotos = {
  satelliteImageUrl?: string;
  routeImageUrl?: string;
  imageUrls: string[];
  /** The posted landmarks, each carrying its uploaded or kept photo. */
  landmarks: DiveSiteLandmark[];
};

export type DiveSitePhotoResult =
  | { ok: true; photos: DiveSitePhotos }
  | { ok: false; reason: "not_configured" | "rejected" };

/** What a site already holds, so an edit can keep, replace, or drop each photo. */
export type ExistingDiveSitePhotos = {
  satelliteImageUrl: string | null;
  routeImageUrl: string | null;
  imageUrls: string[];
  /** As stored; only the photos on it matter here. */
  landmarks: unknown;
};

function landmarkPhotoUrls(landmarks: unknown): string[] {
  return parseDiveSiteLandmarks(landmarks).flatMap((landmark) =>
    landmark.photoUrl ? [landmark.photoUrl] : [],
  );
}

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

  // The landmark list as posted, before `parseDiveSiteLandmarks` drops a
  // nameless row, because the file inputs are named by *posted* index.
  const postedLandmarks = safeJson(String(formData.get(FIELDS.landmarks) ?? "[]"));
  const rawLandmarks: unknown[] = Array.isArray(postedLandmarks) ? postedLandmarks : [];
  // A file is stored only for a row the parser will keep: a nameless row, or
  // one past the cap, would store an object nothing ever references, so a
  // hand-made post can't fill the bucket with orphans.
  let keptRows = 0;
  const uploadsLandmarkPhoto = rawLandmarks.map((entry) => {
    const named =
      typeof entry === "string"
        ? entry.trim() !== ""
        : typeof entry === "object" &&
          entry !== null &&
          typeof (entry as { name?: unknown }).name === "string" &&
          (entry as { name: string }).name.trim() !== "";
    if (!named || keptRows >= MAX_SITE_LANDMARKS) return false;
    keptRows += 1;
    return typeof entry === "object";
  });

  const [mapImage, routeImage, ...rest] = await Promise.all([
    uploadOne(formData.get(FIELDS.mapImage)),
    uploadOne(formData.get(FIELDS.routeImage)),
    ...newGalleryFiles.map((file) => uploadOne(file)),
    ...rawLandmarks.map((_, index) =>
      uploadOne(uploadsLandmarkPhoto[index] ? formData.get(landmarkPhotoField(index)) : null),
    ),
  ]);
  const gallery = rest.slice(0, newGalleryFiles.length);
  const landmarkUploads = rest.slice(newGalleryFiles.length);

  const results = [mapImage, routeImage, ...rest];
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

  // A kept photo has to be one this site already held. The posted JSON is the
  // browser's word, and without this a hand-made post could point a landmark
  // at any object in our storage — and a later save that dropped it would
  // queue that object for deletion.
  const heldLandmarkPhotos = new Set(landmarkPhotoUrls(existing?.landmarks));
  const landmarks = parseDiveSiteLandmarks(
    rawLandmarks.map((entry, index) => {
      if (typeof entry !== "object" || entry === null) return entry;
      const uploaded = landmarkUploads[index];
      const posted = (entry as { photoUrl?: unknown }).photoUrl;
      const photoUrl =
        uploaded?.ok && uploaded.url
          ? uploaded.url
          : typeof posted === "string" && heldLandmarkPhotos.has(posted)
            ? posted
            : undefined;
      return { ...entry, photoUrl };
    }),
  );

  return {
    ok: true,
    photos: {
      landmarks,
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
 * or landmark photo the staffer removed. The caller queues each through
 * `queueAndAttemptMediaDeletion` once the row is durably saved, never before:
 * the local change must not be blocked on storage (CR-012).
 */
export function supersededDiveSitePhotos(
  before: ExistingDiveSitePhotos,
  after: DiveSitePhotos,
): string[] {
  const stillReferenced = new Set(
    [
      after.satelliteImageUrl,
      after.routeImageUrl,
      ...after.imageUrls,
      ...landmarkPhotoUrls(after.landmarks),
    ].filter((url): url is string => Boolean(url)),
  );
  return [
    before.satelliteImageUrl,
    before.routeImageUrl,
    ...before.imageUrls,
    ...landmarkPhotoUrls(before.landmarks),
  ]
    .filter((url): url is string => Boolean(url))
    .filter((url) => !stillReferenced.has(url));
}
