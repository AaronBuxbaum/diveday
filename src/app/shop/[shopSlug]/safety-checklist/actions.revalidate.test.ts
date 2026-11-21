import { describe, expect, it, vi } from "vitest";
import { createChecklistItem, listChecklistItems } from "@/db/pre-departure-check";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * A write that redirects without marking the route stale can leave the page
 * showing the list as it was (`revalidateAndRedirect`'s own contract). Each of
 * the register's three writes marks its page stale.
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
vi.mock("../../../../features/accounts/session", () => ({ requireShopSurface: vi.fn() }));

const { getDb } = await import("@/db/client");
const { revalidatePath } = await import("next/cache");
const { requireShopSurface } = await import("../../../../features/accounts/session");
const { addChecklistItemAction, deleteChecklistItemAction, moveChecklistItemAction } = await import(
  "./actions"
);

describe("the safety checklist actions mark their page stale", () => {
  it("on add, move and delete", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    } as never);
    const page = `/shop/${shop.slug}/safety-checklist`;
    for (const label of ["First line", "Second line"]) {
      await createChecklistItem(db, { shopId: shop.id, personId: owner, label });
    }

    vi.mocked(revalidatePath).mockClear();
    const add = new FormData();
    add.set("label", "Third line");
    await redirectedTo(() => addChecklistItemAction(shop.slug, add));
    expect(revalidatePath).toHaveBeenCalledWith(page);

    const items = await listChecklistItems(db, shop.id);
    const first = items.find((item) => item.label === "Second line");
    if (!first) throw new Error("seeded line missing");

    vi.mocked(revalidatePath).mockClear();
    const move = new FormData();
    move.set("itemId", first.id);
    move.set("direction", "up");
    await redirectedTo(() => moveChecklistItemAction(shop.slug, move));
    expect(revalidatePath).toHaveBeenCalledWith(page);

    vi.mocked(revalidatePath).mockClear();
    const remove = new FormData();
    remove.set("itemId", first.id);
    await redirectedTo(() => deleteChecklistItemAction(shop.slug, remove));
    expect(revalidatePath).toHaveBeenCalledWith(page);
  });
});
