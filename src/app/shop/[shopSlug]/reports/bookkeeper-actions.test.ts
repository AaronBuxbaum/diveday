import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { readBookkeeper } from "@/db/bookkeeper";
import { canPersonExportShopData } from "@/db/export";
import { activityEvents, shops } from "@/db/schema";
import type { Notification } from "@/lib/notifications";
import { rateLimitKey } from "@/lib/rate-limit";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **Who may send the shop's month out to a bookkeeper** (fifth loop, item 35;
 * ADR 20261016-bookkeeper-month-end-email). The address schedules diver names,
 * crew names and money to leave the shop every month, so the save takes the
 * export gate (owner or manager, live roles) and the export step-up before it
 * writes anything; a new address gets a confirm link and no files (security
 * review B1); every set, change and removal is logged and emailed to every
 * owner (F1).
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
const sent = vi.hoisted(() => ({ list: [] as Notification[] }));
vi.mock("@/db/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/notifications")>();
  return {
    ...actual,
    sendNotification: vi.fn(async (_db: unknown, notification: Notification) => {
      sent.list.push(notification);
      return { status: "sent", providerMessageId: "msg" };
    }),
  };
});
const limited = vi.hoisted(() => ({ keys: [] as string[], allow: true }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: async (key: string) => {
      limited.keys.push(key);
      return { allowed: limited.allow, retryAfterMs: 0 };
    },
  };
});
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: () => "https://diveday.example" };
});

const { requireShopSurface } = await import("@/lib/session");
const { hasRequiredStepUp } = await import("@/lib/security-step-up");
const { saveBookkeeperAction } = await import("./bookkeeper-actions");

const idle = { status: "idle" } as const;

async function asOwner({ demo = false } = {}) {
  const { db } = ctx;
  sent.list = [];
  limited.keys = [];
  limited.allow = true;
  await db.update(shops).set({ isDemo: demo }).where(eq(shops.id, ctx.shop.id));
  const [shop] = await db.select().from(shops).where(eq(shops.id, ctx.shop.id));
  if (!shop) throw new Error("shop missing");
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({
      shopId: shop.id,
      shopSlug: shop.slug,
      personId,
      roles: ["owner"],
      name: "Dana Reyes",
    }),
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

const kinds = () => sent.list.map((n) => n.kind);

async function activityCodes(db: typeof ctx.db, shopId: string) {
  const rows = await db
    .select({ code: activityEvents.code })
    .from(activityEvents)
    .where(eq(activityEvents.shopId, shopId));
  return rows.map((row) => row.code).filter((code) => code.startsWith("bookkeeper_"));
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
    expect(sent.list).toEqual([]);
  });

  it("refuses what is not an address, and writes and sends nothing", async () => {
    const { db, shop } = await asOwner();
    await expect(saveBookkeeperAction(shop.slug, idle, form("not an address"))).resolves.toEqual({
      status: "invalid",
    });
    expect(await readBookkeeper(db, shop.id)).toBeNull();
    expect(sent.list).toEqual([]);
  });

  it("saves a new address unconfirmed, sends it a confirm link with no files, logs it and tells the owners", async () => {
    const { db, shop } = await asOwner();
    await expect(
      saveBookkeeperAction(shop.slug, idle, form("  Books@Ledger.example ")),
    ).resolves.toEqual({ status: "confirmation-sent" });
    expect(await readBookkeeper(db, shop.id)).toMatchObject({
      email: "Books@ledger.example",
      confirmedAt: null,
    });
    const link = sent.list.find((n) => n.kind === "bookkeeper_confirmation");
    expect(link).toMatchObject({ to: "Books@ledger.example" });
    expect(link && "attachments" in link).toBe(false);
    expect(kinds()).not.toContain("bookkeeper_month_end");
    expect(sent.list.filter((n) => n.kind === "bookkeeper_notice")[0]).toMatchObject({
      event: "set",
      email: "Books@ledger.example",
      actorName: "Dana Reyes",
    });
    expect(limited.keys).toContain(rateLimitKey("bookkeeper-confirmation", "shop", shop.id));
    expect(await activityCodes(db, shop.id)).toEqual(["bookkeeper_email_set"]);
  });

  it("logs and tells the owners about a change and a removal", async () => {
    const { db, shop } = await asOwner();
    await saveBookkeeperAction(shop.slug, idle, form("books@ledger.example"));
    await saveBookkeeperAction(shop.slug, idle, form("new@ledger.example"));
    await expect(saveBookkeeperAction(shop.slug, idle, form(""))).resolves.toEqual({
      status: "cleared",
    });
    expect(await readBookkeeper(db, shop.id)).toBeNull();
    expect(sent.list.flatMap((n) => (n.kind === "bookkeeper_notice" ? [n.event] : []))).toEqual([
      "set",
      "changed",
      "cleared",
    ]);
    expect(await activityCodes(db, shop.id)).toEqual(
      expect.arrayContaining([
        "bookkeeper_email_set",
        "bookkeeper_email_changed",
        "bookkeeper_email_cleared",
      ]),
    );
  });

  it("says the link could not go when the rate limit refuses it, and the address stays unconfirmed", async () => {
    const { db, shop } = await asOwner();
    limited.allow = false;
    await expect(
      saveBookkeeperAction(shop.slug, idle, form("books@ledger.example")),
    ).resolves.toEqual({ status: "confirmation-not-sent" });
    expect(kinds()).not.toContain("bookkeeper_confirmation");
    expect((await readBookkeeper(db, shop.id))?.confirmedAt).toBeNull();
  });

  it("sends no link and no owner email from a demo shop", async () => {
    const { shop } = await asOwner({ demo: true });
    await expect(
      saveBookkeeperAction(shop.slug, idle, form("books@ledger.example")),
    ).resolves.toEqual({ status: "saved" });
    expect(sent.list).toEqual([]);
  });
});
