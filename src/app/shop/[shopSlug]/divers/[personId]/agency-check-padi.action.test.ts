import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { certifications, people, shops } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **A PADI card certified by DiveChek** (H-20261014-padi-divechek), the PADI half of
 * `agency-check.action.test.ts`.
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { agencyCheckAction } = await import("./agency-check-actions");

async function context() {
  const { db, shop } = ctx;
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

/**
 * PADI DiveChek, read from the staffer's own signed-in PADI Pros' Site. The
 * page is a best guess (#2259); the rule is the same as every agency's, and
 * one record only.
 */
describe("agencyCheckAction with PADI DiveChek", () => {
  const DIVECHEK = [
    "DiveChek",
    "Lena Ortiz",
    "Date of Birth: 12 Apr 1990",
    "Open Water Diver 15 Jun 2015 1506AB1234",
  ].join("\n");

  async function padiCard() {
    // Every shop starts with the PADI checks on, the seeded demo too (H-20261014-padi-divechek, 2026-10-23).
    const { db, shop, owner, personId } = await context();
    const card = await pendingCard(db, shop.id, personId, {
      agency: "padi",
      level: "open_water",
      identifier: "1506AB1234",
    });
    return { db, shop, owner, personId, card };
  }

  it("refuses a PADI card, whatever the page says, at a shop that has not turned PADI checks on", async () => {
    const { db, shop, personId, card } = await padiCard();
    await db.update(shops).set({ padiChecksEnabled: false }).where(eq(shops.id, shop.id));

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, DIVECHEK));

    expect(result).toEqual({ ok: false, reason: "invalid" });
    const row = await cardRow(db, card.id);
    expect(row?.status).toBe("pending");
    expect(row?.agencyCheckedAt).toBeNull();
  });

  it("certifies a PADI card when DiveChek shows this diver, born that day, at that level", async () => {
    const { db, shop, owner, personId, card } = await padiCard();

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, DIVECHEK));

    expect(result).toEqual({
      ok: true,
      verdict: "match",
      effect: "certified",
      undo: { certificationId: card.id },
    });
    const row = await cardRow(db, card.id);
    expect(row?.status).toBe("verified");
    expect(row?.agencyCheckedAt).toBeInstanceOf(Date);
    expect(row?.reviewedByPersonId).toBe(owner);
    expect(row?.reviewNote).toContain("Open Water Diver");
  });

  it("writes nothing for a namesake born on another day", async () => {
    const { db, shop, personId, card } = await padiCard();

    const result = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      check(card.id, DIVECHEK.replace("12 Apr 1990", "3 Sep 1987")),
    );

    // Another person: none of their words come back.
    expect(result).toEqual({ ok: true, verdict: "namesake" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("needs the card's number on DiveChek's record when the card has one", async () => {
    const { db, shop, personId, card } = await padiCard();

    const result = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      check(card.id, DIVECHEK.replace("1506AB1234", "1712CD5678")),
    );

    expect(result).toMatchObject({ ok: true, verdict: "level_unconfirmed" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("refuses a pending PADI divemaster card, which keeps its link", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId, {
      agency: "padi",
      level: "divemaster",
      identifier: "1506AB1234",
    });

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, DIVECHEK));

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("writes nothing when DiveChek lists several divers", async () => {
    const { db, shop, personId, card } = await padiCard();
    const several = `${DIVECHEK}\nLena Ortiz\nDate of Birth: 3 Sep 1987\nRescue Diver`;

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, several));

    expect(result).toEqual({ ok: true, verdict: "several_records" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("writes nothing when DiveChek shows another level", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId, {
      agency: "padi",
      level: "advanced_open_water",
      identifier: "1506AB1234",
    });

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, DIVECHEK));

    expect(result).toMatchObject({ ok: true, verdict: "level_unconfirmed" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("reads PADI's sign-in page as unreadable and writes nothing", async () => {
    const { db, shop, personId, card } = await padiCard();

    const result = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      check(card.id, "PADI Pros’ Site\nSign in\nEmail\nPassword"),
    );

    expect(result).toEqual({ ok: true, verdict: "unreadable" });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("refuses a PADI card on a diver with no birth date, which DiveChek cannot be searched without", async () => {
    const { db, shop } = await context();
    const [undated] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Lena Ortiz" })
      .returning();
    if (!undated) throw new Error("failed to insert a diver");
    const card = await pendingCard(db, shop.id, undated.id, {
      agency: "padi",
      level: "open_water",
      identifier: "1506AB1234",
    });

    expect(await agencyCheckAction(shop.slug, undated.id, null, check(card.id, DIVECHEK))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });
});
