import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { diveSites, globalDiveSites } from "@/db/schema";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The library's "Add to my sites" on a catalog template. It was an inline
 * closure in `page.tsx` that no test could import (2026-10-11 review, item 34).
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
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
const { importDiveSiteTemplateAction } = await import("./actions");

async function signedIn() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return { db, shop, back: shopPath(shop.slug, "dive-sites") };
}

function templateForm(templateId: string): FormData {
  const form = new FormData();
  form.set("templateId", templateId);
  return form;
}

describe("importDiveSiteTemplateAction", () => {
  it("copies the template into the session's shop and opens the new site", async () => {
    const { db, shop, back } = await signedIn();
    const [template] = await db.select({ id: globalDiveSites.id }).from(globalDiveSites).limit(1);
    if (!template) throw new Error("no catalog template seeded");
    const before = await db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), isNull(diveSites.deletedAt)));

    const to = await redirectedTo(() => importDiveSiteTemplateAction(templateForm(template.id)));

    const after = await db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), isNull(diveSites.deletedAt)));
    const added = after.filter((row) => !before.some((old) => old.id === row.id));
    expect(added).toHaveLength(1);
    expect(to).toBe(noticeUrl(`${back}/${added[0]?.id}`, "imported"));
  });

  it("lands back on the library, writing nothing, for a template the catalog does not hold", async () => {
    const { db, shop, back } = await signedIn();
    const count = async () =>
      (await db.select({ id: diveSites.id }).from(diveSites).where(eq(diveSites.shopId, shop.id)))
        .length;
    const before = await count();

    expect(
      await redirectedTo(() => importDiveSiteTemplateAction(templateForm(crypto.randomUUID()))),
    ).toBe(back);
    expect(await count()).toBe(before);
  });
});
