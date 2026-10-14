import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { certifications, people, shops } from "@/db/schema";
import { recordSelfDeclaredCards } from "@/db/self-declared-cards";
import { fileScopedShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

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
const { refresh } = await import("next/cache");
const { requireStaffSession } = await import("@/lib/session");
const { agencyCheckAction } = await import("./card-actions");

const NAUI_PAGE = "Verify Diver Certification\nLena Ortiz\n1990-04-12\nAdvanced Scuba Diver";

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

describe("agencyCheckAction", () => {
  it("certifies the card when the page names the diver at the claimed level", async () => {
    const { db, shop, owner, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, NAUI_PAGE));

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
    expect(row?.reviewNote).toContain("Advanced Scuba Diver");
  });

  /**
   * An imported card was `verified` on arrival: the agency's page confirms it
   * rather than certifying it, and the staffer is told which (as Mark
   * certified tells them).
   */
  it("says an imported card was confirmed, not certified", async () => {
    const { db, shop, personId } = await context();
    const imported = await pendingCard(db, shop.id, personId, {
      status: "verified",
      importedAt: new Date("2026-10-01T00:00:00Z"),
    });

    const result = await agencyCheckAction(
      shop.slug,
      personId,
      null,
      check(imported.id, NAUI_PAGE),
    );

    expect(result).toEqual({
      ok: true,
      verdict: "match",
      effect: "confirmed",
      undo: { certificationId: imported.id },
    });
    expect((await cardRow(db, imported.id))?.agencyCheckedAt).toBeInstanceOf(Date);
  });

  /**
   * A departure's "Check all" asks the page to settle once, at the end of the
   * run, rather than after every card it certifies (D7): each card's post says
   * so, and the write and its revalidation are unchanged.
   */
  it("leaves the refresh to the end of a Check all run", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);
    vi.mocked(refresh).mockClear();
    const form = check(card.id, NAUI_PAGE);
    form.set("refresh", "later");

    const result = await agencyCheckAction(shop.slug, personId, null, form);

    expect(result).toMatchObject({ ok: true, verdict: "match" });
    expect((await cardRow(db, card.id))?.status).toBe("verified");
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * Tenant isolation. The shop is the session's and the diver and card are
   * read under it, so another shop's card certifies nothing and undoes
   * nothing, whether its ids are posted under this shop's slug or under the
   * other shop's.
   */
  it("refuses another shop's diver and card, under either shop's slug", async () => {
    const { db, shop } = await context();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Reef Runners", slug: "reef-runners-agency", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("failed to insert a shop");
    const theirDiver = await diver(db, otherShop.id, "Lena Ortiz");
    const theirCard = await pendingCard(db, otherShop.id, theirDiver);

    expect(
      await agencyCheckAction(shop.slug, theirDiver, null, check(theirCard.id, NAUI_PAGE)),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await agencyCheckAction(shop.slug, theirDiver, null, check(theirCard.id, null, "undo")),
    ).toEqual({ ok: false, reason: "not-undoable" });
    await expect(
      agencyCheckAction(otherShop.slug, theirDiver, null, check(theirCard.id, NAUI_PAGE)),
    ).rejects.toThrow();
    const row = await cardRow(db, theirCard.id);
    expect(row?.status).toBe("pending");
    expect(row?.agencyCheckedAt).toBeNull();
  });

  /**
   * The same action answers the diver record, a departure's Divers tab, the
   * Today list and each card of a "Check all": the page it was pressed on has
   * to settle, whichever that is.
   */
  it("refreshes the page it was pressed on after a write, and only after one", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);
    vi.mocked(refresh).mockClear();

    await agencyCheckAction(shop.slug, personId, null, check(card.id, "No results found"));
    expect(refresh).not.toHaveBeenCalled();

    await agencyCheckAction(shop.slug, personId, null, check(card.id, NAUI_PAGE));
    expect(refresh).toHaveBeenCalledTimes(1);

    await agencyCheckAction(shop.slug, personId, null, check(card.id, null, "undo"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  /**
   * The check is any live staffer's, as Mark certified is: the same gate as
   * every card action on the record (`requireDiverActionContext`), whichever
   * page the button was on. An account no longer staff here writes nothing.
   */
  it("refuses an account that is no longer staff here, wherever it was pressed", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);
    const stranger = await diver(db, shop.id, "Revoked Rae");
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: stranger }),
    );

    await expect(
      agencyCheckAction(shop.slug, personId, null, check(card.id, NAUI_PAGE)),
    ).rejects.toThrow(`REDIRECT:/shop/${shop.slug}/divers/${personId}?notice=not-authorized-cards`);
    expect((await cardRow(db, card.id))?.status).toBe("pending");
  });

  it("lets a captain run it, as a captain may mark a card certified", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);
    const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: captain, roles: ["captain"] }),
    );

    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, NAUI_PAGE));

    expect(result).toMatchObject({ ok: true, verdict: "match" });
    expect((await cardRow(db, card.id))?.reviewedByPersonId).toBe(captain);
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
    // TDI's recreational ratings are SDI's: the extension never checks a TDI card.
    const tdi = await pendingCard(db, shop.id, personId, { agency: "tdi", identifier: "T-1" });

    for (const id of [done.id, tdi.id]) {
      expect(await agencyCheckAction(shop.slug, personId, null, check(id, NAUI_PAGE))).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect((await cardRow(db, tdi.id))?.status).toBe("pending");
  });

  it("refuses a post with no page text", async () => {
    const { db, shop, personId } = await context();
    const card = await pendingCard(db, shop.id, personId);
    expect(await agencyCheckAction(shop.slug, personId, null, check(card.id, null))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  /**
   * PADI DiveChek, read from the staffer's own signed-in PADI Pros' Site. The
   * page is a best guess (#2259); the rule is the same as every agency's, and
   * one record only.
   */
  describe("with PADI DiveChek", () => {
    const DIVECHEK = [
      "DiveChek",
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015 1506AB1234",
    ].join("\n");

    async function padiCard() {
      const { db, shop, owner, personId } = await context();
      const card = await pendingCard(db, shop.id, personId, {
        agency: "padi",
        level: "open_water",
        identifier: "1506AB1234",
      });
      return { db, shop, owner, personId, card };
    }

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

      expect(result).toMatchObject({ ok: true, verdict: "level_unconfirmed" });
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

      expect(
        await agencyCheckAction(shop.slug, undated.id, null, check(card.id, DIVECHEK)),
      ).toEqual({ ok: false, reason: "invalid" });
      expect((await cardRow(db, card.id))?.status).toBe("pending");
    });
  });
});
