import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { diveSites } from "@/db/schema";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The dive-site editor's doors, moved out of `page.tsx` closures. The page now binds the site id,
 * so the id arrives from the client: each door re-validates it and scopes every write to the
 * session's own shop.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const {
  deleteDiveSiteAction,
  pullDiveSiteTemplateAction,
  saveDiveSiteAction,
  undoDiveSiteTemplateAction,
} = await import("./actions");

async function signedIn() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  const [site] = await db
    .select({ id: diveSites.id })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shop.id), isNull(diveSites.deletedAt)))
    .limit(1);
  if (!site) throw new Error("seeded shop has no dive site");
  return { db, shop, siteId: site.id, back: shopPath(shop.slug, "dive-sites") };
}

describe("a malformed site id", () => {
  it("is not found at every door, before any read", async () => {
    await signedIn();
    const form = new FormData();
    await expect(deleteDiveSiteAction("abc")).rejects.toThrow("NOT_FOUND");
    await expect(undoDiveSiteTemplateAction("abc")).rejects.toThrow("NOT_FOUND");
    await expect(pullDiveSiteTemplateAction("abc", form)).rejects.toThrow("NOT_FOUND");
    await expect(saveDiveSiteAction("abc", {}, form)).rejects.toThrow("NOT_FOUND");
  });
});

describe("deleting a site", () => {
  it("soft-deletes it in the session's shop and says so", async () => {
    const { db, siteId, back } = await signedIn();
    expect(await redirectedTo(() => deleteDiveSiteAction(siteId))).toBe(noticeUrl(back, "deleted"));
    const [row] = await db.select().from(diveSites).where(eq(diveSites.id, siteId));
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe("pulling a template update", () => {
  it("refuses a mode it does not know", async () => {
    const { siteId, back } = await signedIn();
    const form = new FormData();
    form.set("mode", "overwrite-everything");
    expect(await redirectedTo(() => pullDiveSiteTemplateAction(siteId, form))).toBe(
      noticeUrl(`${back}/${siteId}`, "template-update-unavailable"),
    );
  });
});
