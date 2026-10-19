import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createChecklistItem } from "@/db/pre-departure-check";
import { preDepartureChecklistItems } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * The checklist register's writes (issue #2659) are owner/manager work, checked
 * against live roles. A captain's hand-made post is refused up front, the item
 * stays, and no success notice is shown.
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
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { addChecklistItemAction, deleteChecklistItemAction, moveChecklistItemAction } = await import(
  "./actions"
);

describe("the safety checklist actions", () => {
  it("refuse a captain, leave the item in place and never say it was removed", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
    const made = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner,
      label: "Spare oxygen bottle",
    });
    expect(made.ok).toBe(true);
    const live = () =>
      db
        .select()
        .from(preDepartureChecklistItems)
        .where(
          and(
            eq(preDepartureChecklistItems.shopId, shop.id),
            isNull(preDepartureChecklistItems.deletedAt),
          ),
        );
    const before = await live();
    const itemId = before.find((row) => row.label === "Spare oxygen bottle")?.id as string;

    vi.mocked(requireShopSurface).mockResolvedValue({
      session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: captain }),
    } as never);
    const refused = `/shop/${shop.slug}/settings?notice=not-authorized`;

    const remove = new FormData();
    remove.set("itemId", itemId);
    const deleted = await redirectedTo(() => deleteChecklistItemAction(shop.slug, remove));
    expect(deleted).toBe(refused);
    expect(deleted).not.toContain("checklist-item-deleted");

    const add = new FormData();
    add.set("label", "Captain's line");
    expect(await redirectedTo(() => addChecklistItemAction(shop.slug, add))).toBe(refused);

    const move = new FormData();
    move.set("itemId", itemId);
    move.set("direction", "down");
    expect(await redirectedTo(() => moveChecklistItemAction(shop.slug, move))).toBe(refused);

    expect((await live()).map((row) => row.label)).toEqual(before.map((row) => row.label));
  });
});
