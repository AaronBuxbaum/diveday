import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { demoPreviews, shops } from "../../../db/schema/index";
import { purgeMintedDemoShops } from "../../../db/seed";
import { DEMO_SHOP_BRAND } from "../../../db/seed/shop-brand";
import { unseededTestDb } from "../../../test/db";
import { PREVIEW_TTL_MS, type PreviewInput } from "./rules";
import {
  findPreview,
  issuePreview,
  recordPreviewActivity,
  recordPreviewFetch,
  recordPreviewOpen,
} from "./store";

/** Any real brand colour; the canonical demo's own, so no hex is typed here. */
const BLUE = DEMO_SHOP_BRAND.brandColor as string;

const NOW = new Date("2026-11-16T12:00:00.000Z");

function input(overrides: Partial<PreviewInput> = {}): PreviewInput {
  return {
    name: "Reef Line Divers",
    site: "https://reefline.example",
    brandColor: BLUE,
    tagline: null,
    locality: "Islamorada",
    region: "FL",
    position: null,
    ...overrides,
  };
}

describe("issuePreview", () => {
  it("mints a demo shop wearing the prospect's name, colour and town, with no logo", async () => {
    const db = await unseededTestDb();
    const preview = await issuePreview(db, input(), NOW);

    const [shop] = await db.select().from(shops).where(eq(shops.slug, preview.shopSlug));
    expect(shop).toMatchObject({
      isDemo: true,
      name: "Reef Line Divers",
      brandColor: BLUE,
      addressLocality: "Islamorada",
      addressRegion: "FL",
      logoUrl: null,
    });
    expect(preview.expiresAt.getTime()).toBe(NOW.getTime() + PREVIEW_TTL_MS);
    expect(preview).toMatchObject({ fetchCount: 0, openCount: 0, activeCount: 0 });
  });

  it("keeps the demo's own colour and town when none is given", async () => {
    const db = await unseededTestDb();
    const preview = await issuePreview(
      db,
      input({ brandColor: null, locality: null, region: null }),
      NOW,
    );
    const [shop] = await db.select().from(shops).where(eq(shops.slug, preview.shopSlug));
    expect(shop.brandColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(shop.addressLocality).toBe("Key Largo");
  });
});

describe("the three signals", () => {
  it("counts a fetch, an open and activity apart, and names the first of each", async () => {
    const db = await unseededTestDb();
    const preview = await issuePreview(db, input(), NOW);
    const later = new Date(NOW.getTime() + 60_000);

    await recordPreviewFetch(db, preview.id, NOW);
    await recordPreviewFetch(db, preview.id, later);
    let row = await findPreview(db, preview.id);
    expect(row).toMatchObject({ fetchCount: 2, firstFetchedAt: NOW, openCount: 0, activeCount: 0 });

    expect(await recordPreviewOpen(db, preview.id, NOW)).toEqual({ first: true });
    expect(await recordPreviewOpen(db, preview.id, later)).toEqual({ first: false });
    row = await findPreview(db, preview.id);
    expect(row).toMatchObject({ openCount: 2, firstOpenedAt: NOW, lastOpenedAt: later });
    expect(row?.activeCount).toBe(0);

    const first = await recordPreviewActivity(db, preview.demoShopId, NOW);
    expect(first?.id).toBe(preview.id);
    expect(await recordPreviewActivity(db, preview.demoShopId, later)).toBeNull();
    row = await findPreview(db, preview.id);
    expect(row).toMatchObject({ activeCount: 2, firstActiveAt: NOW, lastActiveAt: later });
  });

  it("matches nothing for a shop that is not a preview, or a link that never existed", async () => {
    const db = await unseededTestDb();
    expect(await recordPreviewActivity(db, "3f2504e0-4f89-41d3-9a0c-0305e82c3301", NOW)).toBeNull();
    expect(await recordPreviewOpen(db, "3f2504e0-4f89-41d3-9a0c-0305e82c3301", NOW)).toEqual({
      first: false,
    });
    expect(await findPreview(db, "3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBeNull();
  });
});

describe("after the reaper", () => {
  it("keeps the record of who looked when the demo shop is deleted", async () => {
    const db = await unseededTestDb();
    const preview = await issuePreview(db, input(), NOW);
    await recordPreviewOpen(db, preview.id, NOW);

    await purgeMintedDemoShops(db);

    expect(await db.select().from(shops).where(eq(shops.slug, preview.shopSlug))).toEqual([]);
    const [kept] = await db.select().from(demoPreviews).where(eq(demoPreviews.id, preview.id));
    expect(kept.openCount).toBe(1);
  });
});
