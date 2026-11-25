import { eq, sql } from "drizzle-orm";
import type { AppDb, DbExecutor } from "../../../db/client";
import { type DemoPreview, demoPreviews, shops } from "../../../db/schema/index";
import { createDemoShop, dressPreviewShop } from "../../../db/seed";
import { nowDate } from "../../../lib/clock";
import { PREVIEW_TTL_MS, type PreviewInput } from "./rules";

/**
 * Build one prospect's preview: a minted demo shop with the usual seeded
 * divers and boats, wearing the prospect's own name, colour and town, its
 * day boats sailing at the prospect's times on hulls with the prospect's boat
 * names, and the row whose id is the link (ADR 20261116-demo-previews).
 *
 * The demo's logo comes off, because a stock photograph beside somebody
 * else's name reads as a mistake, and the prospect's own logo is theirs to
 * add. The shop and the row commit together: a link with no shop behind it
 * would be a dead email.
 */
export async function issuePreview(
  db: AppDb,
  input: PreviewInput,
  now: Date = nowDate(),
): Promise<DemoPreview> {
  return db.transaction(async (tx) => {
    const { slug } = await createDemoShop(tx, { brand: true });
    await tx
      .update(shops)
      .set({
        name: input.name,
        logoUrl: null,
        ...(input.brandColor ? { brandColor: input.brandColor } : {}),
        ...(input.tagline ? { tagline: input.tagline } : {}),
        ...(input.locality ? { addressLocality: input.locality } : {}),
        ...(input.region ? { addressRegion: input.region } : {}),
        ...(input.position ?? {}),
      })
      .where(eq(shops.slug, slug));
    const [shop] = await tx.select({ id: shops.id }).from(shops).where(eq(shops.slug, slug));
    const [preview] = await tx
      .insert(demoPreviews)
      .values({
        demoShopId: shop.id,
        shopSlug: slug,
        prospectName: input.name,
        prospectSite: input.site,
        departureTimes: input.departureTimes,
        boatNames: input.boatNames,
        createdAt: now,
        expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
      })
      .returning();
    // The row first: the dress is read from it, here and after every reset.
    await dressPreviewShop(tx, shop.id, now);
    return preview;
  });
}

/** The preview a link names, or null. `id` is already shaped by `previewIdFrom`. */
export async function findPreview(db: DbExecutor, id: string): Promise<DemoPreview | null> {
  const [preview] = await db.select().from(demoPreviews).where(eq(demoPreviews.id, id)).limit(1);
  return preview ?? null;
}

/** Any request for the link's page, a mail scanner's included. Never an open. */
export async function recordPreviewFetch(
  db: DbExecutor,
  id: string,
  now: Date = nowDate(),
): Promise<void> {
  await db
    .update(demoPreviews)
    .set({
      fetchCount: sql`${demoPreviews.fetchCount} + 1`,
      firstFetchedAt: sql`coalesce(${demoPreviews.firstFetchedAt}, ${now})`,
    })
    .where(eq(demoPreviews.id, id));
}

/** A browser ran the page and entered the shop. Answers whether it was the first. */
export async function recordPreviewOpen(
  db: DbExecutor,
  id: string,
  now: Date = nowDate(),
): Promise<{ first: boolean }> {
  const [row] = await db
    .update(demoPreviews)
    .set({
      openCount: sql`${demoPreviews.openCount} + 1`,
      firstOpenedAt: sql`coalesce(${demoPreviews.firstOpenedAt}, ${now})`,
      lastOpenedAt: now,
    })
    .where(eq(demoPreviews.id, id))
    .returning({ openCount: demoPreviews.openCount });
  return { first: row?.openCount === 1 };
}

/**
 * Real input inside a shop: the one signal that is a person. Called with the
 * id of whatever shop a staff session just touched, so it is one indexed
 * update that matches nothing for every shop that is not a preview. Answers
 * the preview when this was its first activity, and null otherwise.
 */
export async function recordPreviewActivity(
  db: DbExecutor,
  shopId: string,
  now: Date = nowDate(),
): Promise<DemoPreview | null> {
  const [row] = await db
    .update(demoPreviews)
    .set({
      activeCount: sql`${demoPreviews.activeCount} + 1`,
      firstActiveAt: sql`coalesce(${demoPreviews.firstActiveAt}, ${now})`,
      lastActiveAt: now,
    })
    .where(eq(demoPreviews.demoShopId, shopId))
    .returning();
  return row?.activeCount === 1 ? row : null;
}
