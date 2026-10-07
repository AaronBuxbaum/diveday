import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { AppDb } from "./client";
import { diveSites } from "./schema";

type PhotoColumns = {
  satelliteImageUrl: string | null;
  routeImageUrl: string | null;
  imageUrls: string[];
  landmarks: unknown;
};

/**
 * The landmark photos as stored, read without `parseDiveSiteLandmarks`: that
 * parser drops a photo it would not accept today, and a row holding one still
 * holds it as far as storage is concerned.
 */
function landmarkPhotoUrls(landmarks: unknown): string[] {
  if (!Array.isArray(landmarks)) return [];
  return landmarks.flatMap((entry) => {
    const photoUrl =
      entry && typeof entry === "object" ? (entry as { photoUrl?: unknown }).photoUrl : null;
    return typeof photoUrl === "string" ? [photoUrl] : [];
  });
}

function photoUrlsOf(row: PhotoColumns): string[] {
  return [
    row.satelliteImageUrl,
    row.routeImageUrl,
    ...row.imageUrls,
    ...landmarkPhotoUrls(row.landmarks),
  ].filter((url): url is string => Boolean(url));
}

const photoColumns = {
  satelliteImageUrl: diveSites.satelliteImageUrl,
  routeImageUrl: diveSites.routeImageUrl,
  imageUrls: diveSites.imageUrls,
  landmarks: diveSites.landmarks,
};

/**
 * **Every photo URL this shop's own dive sites hold**, deleted sites included
 * (issue #2078).
 *
 * Stored object keys carry no shop, so the dive-site import cannot tell from a
 * URL whose object it names. This set is how it tells: a stored URL in a file
 * is kept only when this shop already holds it, which is exactly what the
 * shop's own export carries. Deleted sites count because a restore brings them
 * back too.
 */
export async function diveSitePhotoUrlsHeldByShop(db: AppDb, shopId: string): Promise<Set<string>> {
  const rows = await db.select(photoColumns).from(diveSites).where(eq(diveSites.shopId, shopId));
  return new Set(rows.flatMap(photoUrlsOf));
}

/**
 * **The photos among `urls` that this shop holds and no other dive site
 * does** — the only ones a save taking them off `siteId` may delete from
 * storage (issue #2078). Call it *before* that save writes, while `siteId`
 * still holds them.
 *
 * A stored URL can sit on more than one row: `copyDiveSite` carries the
 * original's photos onto the copy, and before #2078 an import could name any
 * object on our media origin, another shop's included. Deleting the object
 * because one row let go of it breaks every other row that still shows it, and
 * when that row is another shop's, the failed picture is on their public page
 * while the deletion is filed under this shop, where they never see it.
 *
 * **This reads across shops on purpose, and answers nothing about them.**
 * `urls` is first cut down to what this shop's own sites hold
 * (`diveSitePhotoUrlsHeldByShop`), so a caller can only ever ask about photos
 * it already has, and the answer is a subset of those; no other shop's row, id
 * or field leaves this function. Deleted sites count: a restore brings them
 * back with their photos.
 *
 * The catalog (`global_dive_site_versions`) is not a holder: its briefings name
 * only bundled root-relative paths under `public/`, which storage never
 * deletes (`queueMediaDeletion` refuses them), and `dive-site-photos.test.ts`
 * holds every template to that.
 */
export async function diveSitePhotosNoOtherSiteHolds(
  db: AppDb,
  shopId: string,
  siteId: string,
  urls: readonly string[],
): Promise<string[]> {
  if (urls.length === 0) return [];
  const ours = await diveSitePhotoUrlsHeldByShop(db, shopId);
  const wanted = new Set(urls.filter((url) => ours.has(url)));
  if (wanted.size === 0) return [];
  const list = sql`array[${sql.join(
    [...wanted].map((url) => sql`${url}`),
    sql`, `,
  )}]::text[]`;
  // Narrowed in SQL to the rows naming one of `urls`, so a save reads the
  // handful of sites sharing a photo rather than every site on the platform.
  // `landmarks` is guarded to an array first: `jsonb_array_elements` raises on
  // anything else, and one malformed row anywhere must not fail every save.
  const others = await db
    .select(photoColumns)
    .from(diveSites)
    .where(
      and(
        ne(diveSites.id, siteId),
        or(
          inArray(diveSites.satelliteImageUrl, [...wanted]),
          inArray(diveSites.routeImageUrl, [...wanted]),
          sql`${diveSites.imageUrls} ?| ${list}`,
          sql`exists (select 1 from jsonb_array_elements(case when jsonb_typeof(${diveSites.landmarks}) = 'array' then ${diveSites.landmarks} else '[]'::jsonb end) as landmark where jsonb_typeof(landmark) = 'object' and landmark->>'photoUrl' = any(${list}))`,
        ),
      ),
    );
  const held = new Set(others.flatMap(photoUrlsOf).filter((url) => wanted.has(url)));
  return [...wanted].filter((url) => !held.has(url));
}
