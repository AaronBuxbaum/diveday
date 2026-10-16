import { describe, expect, it, vi } from "vitest";
import { readBookkeeper } from "@/db/bookkeeper";
import { canPersonExportShopData } from "@/db/export";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **Who may send the shop's month out to a bookkeeper** (fifth loop, item 35;
 * ADR 20261016-bookkeeper-month-end-email). The address schedules diver names,
 * crew names and money to leave the shop every month, so the save takes the
 * export gate (owner or manager, live roles) and the export step-up before it
 * writes anything.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/security-step-up", () => ({
  hasRequiredStepUp: vi.fn(async () => true),
  stepUpChallengeUrl: vi.fn(() => "/step-up"),
}));

const { requireShopSurface } = await import("@/lib/session");
const { hasRequiredStepUp } = await import("@/lib/security-step-up");
const { saveBookkeeperAction } = await import("./bookkeeper-actions");

const idle = { status: "idle" } as const;

async function asOwner() {
  const { db, shop } = ctx;
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId, roles: ["owner"] }),
    db,
    shop,
  } as never);
  return { db, shop, personId };
}

function form(email: string) {
  const data = new FormData();
  data.set("email", email);
  return data;
}

describe("saveBookkeeperAction", () => {
  it("asks the surface for the export gate, so a captain is refused before any write", async () => {
    const { shop } = await asOwner();
    await saveBookkeeperAction(shop.slug, idle, form("books@ledger.example"));
    expect(vi.mocked(requireShopSurface).mock.calls[0]?.[1]).toMatchObject({
      allow: canPersonExportShopData,
    });
  });

  it("sends a staffer without a fresh step-up to the challenge, and writes nothing", async () => {
    const { db, shop } = await asOwner();
    vi.mocked(hasRequiredStepUp).mockResolvedValueOnce(false);
    await expect(
      saveBookkeeperAction(shop.slug, idle, form("books@ledger.example")),
    ).rejects.toThrow("REDIRECT:/step-up");
    expect(await readBookkeeper(db, shop.id)).toBeNull();
  });

  it("saves a valid address under the staffer's name, and refuses one that is not", async () => {
    const { db, shop } = await asOwner();
    await expect(saveBookkeeperAction(shop.slug, idle, form("not an address"))).resolves.toEqual({
      status: "invalid",
    });
    expect(await readBookkeeper(db, shop.id)).toBeNull();
    await expect(
      saveBookkeeperAction(shop.slug, idle, form("  Books@Ledger.example ")),
    ).resolves.toEqual({ status: "saved" });
    expect((await readBookkeeper(db, shop.id))?.email).toBe("books@ledger.example");
  });

  it("turns the email off when the field is emptied", async () => {
    const { db, shop } = await asOwner();
    await saveBookkeeperAction(shop.slug, idle, form("books@ledger.example"));
    await expect(saveBookkeeperAction(shop.slug, idle, form(""))).resolves.toEqual({
      status: "cleared",
    });
    expect(await readBookkeeper(db, shop.id)).toBeNull();
  });
});
