import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { certifications, people } from "@/db/schema";
import { recordSelfDeclaredCards } from "@/db/self-declared-cards";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

/**
 * **A card certified by the agency's own page** (H-105).
 *
 * The extension hands back whatever text the agency's page showed; the verdict
 * is the server's, from the card and the diver as the database holds them.
 * These tests are about what that page text can and cannot do: certify the
 * one card it names, at the level it names, and nothing else.
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
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { agencyCheckAction } = await import("./card-actions");

const NAUI_PAGE = "Verify Diver Certification\nLena Ortiz\n1990-04-12\nAdvanced Scuba Diver";

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  const personId = await diver(db, shop.id, "Lena Ortiz");
  return { db, shop, owner, personId };
}

async function diver(db: AppDb, shopId: string, fullName: string) {
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName, dateOfBirth: "1990-04-12" })
    .returning();
  if (!person) throw new Error("failed to insert a diver");
  return person.id;
}

async function pendingCard(
  db: AppDb,
  shopId: string,
  personId: string,
  values: Partial<typeof certifications.$inferInsert> = {},
) {
  const [card] = await db
    .insert(certifications)
    .values({
      shopId,
      personId,
      agency: "naui",
      level: "advanced_open_water",
      identifier: `N-${personId.slice(0, 8)}`,
      status: "pending",
      ...values,
    })
    .returning();
  if (!card) throw new Error("failed to insert a card");
  return card;
}

function check(certificationId: string, pageText: string | null, intent?: "undo") {
  const formData = new FormData();
  formData.set("certificationId", certificationId);
  if (pageText !== null) formData.set("pageText", pageText);
  if (intent) formData.set("intent", intent);
  return formData;
}

async function cardRow(db: AppDb, id: string) {
  const [row] = await db.select().from(certifications).where(eq(certifications.id, id));
  return row;
}

describe("agencyCheckAction", () => {
  it("certifies the card when the page names the diver at the claimed level", async () => {
    const { db, shop, owner, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, NAUI_PAGE));

    expect(result).toEqual({ ok: true, verdict: "match", undo: { certificationId: card.id } });
    const row = await cardRow(db, card.id);
    expect(row?.status).toBe("verified");
    expect(row?.agencyCheckedAt).toBeInstanceOf(Date);
    expect(row?.reviewedByPersonId).toBe(owner);
    expect(row?.reviewNote).toContain("Advanced Scuba Diver");
  });

  it("puts the card back, stamp and all, on Undo", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);
    await agencyCheckAction(shop.slug, personId, null, check(card.id, NAUI_PAGE));

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, null, "undo"));

    expect(result).toEqual({ ok: true, verdict: "undone" });
    const row = await cardRow(db, card.id);
    expect(row?.status).toBe("pending");
    expect(row?.agencyCheckedAt).toBeNull();
    expect(row?.reviewNote).toBeNull();
  });

  it("refuses to undo a review the check did not make", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId, {
      status: "verified",
      reviewedAt: new Date("2026-10-01T00:00:00Z"),
    });

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, null, "undo"));

    expect(result).toEqual({ ok: false, reason: "not-undoable" });
    expect((await cardRow(db, card.id))?.status).toBe("verified");
  });

  it("writes nothing when the page shows the diver but not this level", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId, { level: "rescue" });

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, NAUI_PAGE));

    expect(result).toMatchObject({ ok: true, verdict: "level_unconfirmed" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("writes nothing on 'no results' or an unreadable page", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);

    expect(
      await agencyCheckAction(shop.slug, personId, null, check(card.id, "No results found")),
    ).toEqual({ ok: true, verdict: "no_record" });
    expect(
      await agencyCheckAction(
        shop.slug,
        personId,
        null,
        check(card.id, "Please verify you are human"),
      ),
    ).toEqual({ ok: true, verdict: "unreadable" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("judges by the diver on file, so a page naming somebody else certifies nothing", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);

    const result = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      check(card.id, "Sam Reyes\nAdvanced Scuba Diver"),
    );

    expect(result).toEqual({ ok: true, verdict: "unreadable" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("refuses a card that belongs to another diver", async () => {
    const { db, shop, personId } = await context();
    const otherId = await diver(db, shop.id, "Lena Ortiz");
    const othersCard = await pendingCard(db, shop.id, otherId);

    const result = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      check(othersCard.id, NAUI_PAGE),
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect((await cardRow(db, othersCard.id))?.status).toBe("pending");
  });

  it("refuses a diver's own unsighted claim, which still needs the card in hand", async () => {
    const { db, shop, personId } = await context();
    await recordSelfDeclaredCards(db, { shopId: shop.id, personId, level: "advanced_open_water" });
    const [claim] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, personId));
    if (!claim) throw new Error("self-declaration wrote no card");

    const result = await agencyCheckAction(shop.slug, personId, null, check(claim.id, NAUI_PAGE));

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect((await cardRow(db, claim.id))?.status).toBe("pending");
  });

  it("refuses a card already certified, and an agency it does not check", async () => {
    const { db, shop, personId } = await context();
    const done = await pendingCard(db, shop.id, personId, { status: "verified" });
    const padi = await pendingCard(db, shop.id, personId, { agency: "padi", identifier: "P-1" });

    for (const id of [done.id, padi.id]) {
      expect(await agencyCheckAction(shop.slug, personId, null, check(id, NAUI_PAGE))).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect((await cardRow(db, padi.id))?.status).toBe("pending");
  });

  it("refuses a post with no page text", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);
    expect(await agencyCheckAction(shop.slug, personId, null, check(card.id, null))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
