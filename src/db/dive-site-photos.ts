import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { AppDb, DbExecutor } from "./client";
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

declare const ownedPhotos: unique symbol;

/**
 * Photo URLs this shop's own sites held when they were read — the only input
 * {@link diveSitePhotosNoOtherSiteHolds} takes. Branded so that function cannot
 * be handed a URL that did not come through {@link ownedDiveSitePhotos}.
 */
export type OwnedDiveSitePhotos = readonly string[] & { readonly [ownedPhotos]: true };

/**
 * **Step one of releasing photos: which of `urls` are this shop's** (issue
 * #2078). Call it *before* the save that lets go of them, while the site still
 * holds them; a URL this shop has never held is dropped here, so the
 * cross-shop question in step two can only ever be asked about photos the
 * caller already has.
 */
export async function ownedDiveSitePhotos(
  db: AppDb,
  shopId: string,
  urls: readonly string[],
): Promise<OwnedDiveSitePhotos> {
  if (urls.length === 0) return [] as unknown as OwnedDiveSitePhotos;
  const ours = await diveSitePhotoUrlsHeldByShop(db, shopId);
  return [...new Set(urls.filter((url) => ours.has(url)))] as unknown as OwnedDiveSitePhotos;
}

/**
 * **Step two: the owned photos no other dive site still holds** — the only
 * ones a save taking them off `siteId` may delete from storage (issue #2078).
 * Call it *after* that save has written, so a copy or an import that landed in
 * between is read as a holder rather than having its photo deleted under it.
 * (Not inside the save's transaction: `updateDiveSiteForForm` opens its own.
 * What is left is the gap between this read and the deletion, a concurrent
 * copy of a site whose photo was removed in the same instant.)
 *
 * A stored URL can sit on more than one row: `copyDiveSite` carries the
 * original's photos onto the copy, and before #2078 an import could name any
 * object on our media origin, another shop's included. Deleting the object
 * because one row let go of it breaks every other row that still shows it, and
 * when that row is another shop's, the failed picture is on their public page
 * while the deletion is filed under this shop, where they never see it.
 *
 * **This reads across shops on purpose, and answers nothing about them.** Its
 * input is already cut down to this shop's own photos (step one), and the
 * answer is a subset of those; no other shop's row, id or field leaves this
 * function. Deleted sites count: a restore brings them back with their photos.
 *
 * The catalog (`global_dive_site_versions`) is not a holder: its briefings name
 * only bundled root-relative paths under `public/`, which storage never
 * deletes (`queueMediaDeletion` refuses them), and `dive-site-photos.test.ts`
 * holds every template to that.
 */
export async function diveSitePhotosNoOtherSiteHolds(
  db: AppDb,
  siteId: string,
  owned: OwnedDiveSitePhotos,
): Promise<string[]> {
  const wanted = new Set<string>(owned);
  if (wanted.size === 0) return [];
  const others = await db
    .select(photoColumns)
    .from(diveSites)
    .where(and(ne(diveSites.id, siteId), namesAnyPhoto([...wanted])));
  const held = new Set(others.flatMap(photoUrlsOf).filter((url) => wanted.has(url)));
  return [...wanted].filter((url) => !held.has(url));
}

/**
 * The dive-site rows naming one of `urls` in any photo field. Narrowed in SQL
 * so a caller reads the handful of sites sharing a photo rather than every site
 * on the platform. `landmarks` is guarded to an array first:
 * `jsonb_array_elements` raises on anything else, and one malformed row
 * anywhere must not fail every save.
 */
function namesAnyPhoto(urls: readonly string[]) {
  const list = sql`array[${sql.join(
    urls.map((url) => sql`${url}`),
    sql`, `,
  )}]::text[]`;
  return or(
    inArray(diveSites.satelliteImageUrl, [...urls]),
    inArray(diveSites.routeImageUrl, [...urls]),
    sql`${diveSites.imageUrls} ?| ${list}`,
    sql`exists (select 1 from jsonb_array_elements(case when jsonb_typeof(${diveSites.landmarks}) = 'array' then ${diveSites.landmarks} else '[]'::jsonb end) as landmark where jsonb_typeof(landmark) = 'object' and landmark->>'photoUrl' = any(${list}))`,
  );
}

/**
 * **Whether any dive site still holds `url`, asked just before storage deletes
 * it** (issue #2193). The media-deletion worker's last word: a copy or an
 * import that committed a row naming the photo after the edit page read its
 * holders (step two above) would otherwise lose its picture.
 *
 * Every site counts, deleted ones included (a restore brings them back), and
 * in any shop for the reason step two reads across shops: deleting an object
 * another row still shows breaks that row. The answer is one boolean about a
 * URL the caller already queued, so nothing about another shop leaves here.
 */
export async function diveSitePhotoStillHeld(db: DbExecutor, url: string): Promise<boolean> {
  const rows = await db
    .select(photoColumns)
    .from(diveSites)
    .where(namesAnyPhoto([url]));
  return rows.some((row) => photoUrlsOf(row).includes(url));
}

/**
 * Both halves of letting a saved site's photos go (issue #2078), for a caller
 * that writes in between: which of `superseded` are this shop's is asked now,
 * while the site still holds them, and whether another site still shows one
 * is asked by the returned function, once the write has landed.
 */
export async function planDiveSitePhotoRelease(
  db: AppDb,
  shopId: string,
  siteId: string,
  superseded: readonly string[],
): Promise<() => Promise<string[]>> {
  const candidates = await ownedDiveSitePhotos(db, shopId, superseded);
  return () => diveSitePhotosNoOtherSiteHolds(db, siteId, candidates);
}
