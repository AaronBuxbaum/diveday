import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { certifications, nitroxCertifications, people, specialtyCertifications } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **A nitrox or specialty card certified by the agency's own page** (H-20261008-cert-check-extension, issue #2592), in a file of its own so the level-card tests stay under the file-length limit.
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

const _NAUI_PAGE = "Verify Diver Certification\nLena Ortiz\n1990-04-12\nAdvanced Scuba Diver";

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

async function _cardRow(db: AppDb, id: string) {
  const [row] = await db.select().from(certifications).where(eq(certifications.id, id));
  return row;
}

/**
 * **A nitrox or specialty card certified by the agency's own page** (issue
 * #2592). The same server-side verdict as a level card, by the closed wording
 * for the kind, with its own Undo; and nothing a page says reaches a card that
 * needs a sighting, or a card of another table.
 */
describe("agencyCheckAction on a nitrox or specialty card", () => {
  const NAUI_RECORD = (...lines: string[]) =>
    ["Verify Diver Certification", "Lena Ortiz", "1990-04-12", "Card N-777", ...lines].join("\n");

  function checkCard(certificationId: string, pageText: string, cardType: string, intent?: "undo") {
    const formData = check(certificationId, pageText, intent);
    formData.set("cardType", cardType);
    return formData;
  }

  async function nitroxCard(
    db: AppDb,
    shopId: string,
    personId: string,
    values: Partial<typeof nitroxCertifications.$inferInsert> = {},
  ) {
    const [card] = await db
      .insert(nitroxCertifications)
      .values({ shopId, personId, agency: "naui", identifier: "N-777", ...values })
      .returning();
    if (!card) throw new Error("failed to insert a nitrox card");
    return card;
  }

  async function deepCard(db: AppDb, shopId: string, personId: string) {
    const [card] = await db
      .insert(specialtyCertifications)
      .values({ shopId, personId, agency: "naui", specialty: "deep", identifier: "N-777" })
      .returning();
    if (!card) throw new Error("failed to insert a specialty card");
    return card;
  }

  it("certifies a nitrox card and a specialty card the page lists, each with its own Undo", async () => {
    const { db, shop, owner, personId } = await context();
    const gas = await nitroxCard(db, shop.id, personId);
    const deep = await deepCard(db, shop.id, personId);
    const page = NAUI_RECORD("Enriched Air Nitrox Diver 2021-05-12", "Deep Diver 2022-03-01");

    expect(
      await agencyCheckAction(shop.slug, personId, null, checkCard(gas.id, page, "nitrox")),
    ).toEqual({
      ok: true,
      verdict: "match",
      effect: "certified",
      undo: { certificationId: gas.id },
    });
    expect(
      await agencyCheckAction(shop.slug, personId, null, checkCard(deep.id, page, "specialty")),
    ).toEqual({
      ok: true,
      verdict: "match",
      effect: "certified",
      undo: { certificationId: deep.id },
    });
    const [gasRow] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, gas.id));
    expect(gasRow).toMatchObject({ status: "verified", reviewedByPersonId: owner });
    expect(gasRow?.agencyCheckedAt).toBeInstanceOf(Date);
    expect(gasRow?.reviewNote).toContain("Enriched Air Nitrox Diver");

    const undone = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      checkCard(gas.id, "", "nitrox", "undo"),
    );
    expect(undone).toEqual({ ok: true, verdict: "undone" });
    const [after] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, gas.id));
    expect(after).toMatchObject({ status: "pending", agencyCheckedAt: null, reviewedAt: null });
    // The other card was not touched by it.
    const [deepRow] = await db
      .select({ status: specialtyCertifications.status })
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.id, deep.id));
    expect(deepRow?.status).toBe("verified");
  });

  it("writes nothing when the page shows the diver but not this certification", async () => {
    const { db, shop, personId } = await context();
    const gas = await nitroxCard(db, shop.id, personId);
    const result = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      checkCard(gas.id, NAUI_RECORD("Advanced Scuba Diver", "Deep Diver"), "nitrox"),
    );
    expect(result).toMatchObject({ ok: true, verdict: "level_unconfirmed", listedCard: true });
    const [row] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, gas.id));
    expect(row).toMatchObject({ status: "pending", reviewedAt: null, agencyCheckedAt: null });
  });

  it("refuses a card that needs the card in hand, however the page reads", async () => {
    const { db, shop, personId } = await context();
    const claim = await nitroxCard(db, shop.id, personId, {
      selfDeclaredAt: new Date("2026-10-01T00:00:00Z"),
    });
    const result = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      checkCard(claim.id, NAUI_RECORD("Enriched Air Nitrox Diver"), "nitrox"),
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
    const [row] = await db
      .select({ status: nitroxCertifications.status })
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, claim.id));
    expect(row?.status).toBe("pending");
  });

  it("will not take one table's card for another's, nor a table the form invents", async () => {
    const { db, shop, personId } = await context();
    const gas = await nitroxCard(db, shop.id, personId);
    const level = await pendingCard(db, shop.id, personId);
    const page = NAUI_RECORD("Enriched Air Nitrox Diver", "Advanced Scuba Diver");
    for (const [id, cardType] of [
      [gas.id, "specialty"],
      [level.id, "nitrox"],
      [gas.id, "garbage"],
    ] as const) {
      expect(
        await agencyCheckAction(shop.slug, personId, null, checkCard(id, page, cardType)),
        cardType,
      ).toEqual({ ok: false, reason: "invalid" });
    }
    // A level card's Undo is not a nitrox card's, nor the other way round.
    await agencyCheckAction(shop.slug, personId, null, checkCard(gas.id, page, "nitrox"));
    expect(await agencyCheckAction(shop.slug, personId, null, check(gas.id, "", "undo"))).toEqual({
      ok: false,
      reason: "not-undoable",
    });
  });
});
