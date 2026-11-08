import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { unseededTestDb } from "@/test/db";
import { recordSetupRequest } from "../features/funnel/store";
import { issueSetupLink } from "../features/setup-links/store";
import { createSignedUpShop } from "../features/shop-signup/store";
import { preDepartureChecklistItems } from "./schema";

async function signUp(slug: string) {
  const db = await unseededTestDb();
  const request = await recordSetupRequest(db, {
    shopName: "Reef Runners",
    region: "Key Largo",
    runsBoat: true,
    currentSystem: "paper",
    contactName: "Marisol Vega",
    email: `owner@${slug}.example`,
    phone: null,
    source: "pricing",
    locale: "en-US",
  });
  const { token } = await issueSetupLink(db, { setupRequestId: request.id });
  const outcome = await createSignedUpShop(db, {
    setupToken: token,
    shopName: "Reef Runners",
    shopSlug: slug,
    timezone: "America/New_York",
    ownerName: "Marisol Vega",
    ownerEmail: `owner@${slug}.example`,
    ownerPassword: "a long enough password 1",
    firstChecklistLine: staffTranslator("en-US")("settings.safetyChecklist.defaultLine"),
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return { db, shop: outcome.shop };
}

describe("createSignedUpShop", () => {
  // Issue #2301 (Aaron, 2026-10-13): the pre-departure check asks about oxygen
  // on every new shop's boats from the first departure.
  it("starts the pre-departure checklist with the oxygen line, in the shop's language", async () => {
    const { db, shop } = await signUp("o2-default");
    const items = await db
      .select({
        label: preDepartureChecklistItems.label,
        sortOrder: preDepartureChecklistItems.sortOrder,
        deletedAt: preDepartureChecklistItems.deletedAt,
      })
      .from(preDepartureChecklistItems)
      .where(eq(preDepartureChecklistItems.shopId, shop.id));
    expect(items).toEqual([
      { label: "O2 kit aboard and cylinder full", sortOrder: 0, deletedAt: null },
    ]);
  });

  it("writes no checklist line when the signup is refused", async () => {
    const db = await unseededTestDb();
    const outcome = await createSignedUpShop(db, {
      setupToken: "never-minted",
      shopName: "Reef Runners",
      shopSlug: "refused",
      timezone: "America/New_York",
      ownerName: "Marisol Vega",
      ownerEmail: "owner@refused.example",
      ownerPassword: "a long enough password 1",
      firstChecklistLine: staffTranslator("en-US")("settings.safetyChecklist.defaultLine"),
    });
    expect(outcome).toEqual({ ok: false, reason: "setup_link_closed" });
    expect(await db.select().from(preDepartureChecklistItems)).toEqual([]);
  });
});
