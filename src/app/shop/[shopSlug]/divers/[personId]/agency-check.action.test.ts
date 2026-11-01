import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { addAgencyListedCards } from "@/db/agency-check";
import type { AppDb } from "@/db/client";
import { reviewNitroxCertification, unreviewNitroxCertification } from "@/db/nitrox";
import {
  certifications,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
} from "@/db/schema";
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
 * **A card certified by the agency's own page** (H-20261008-cert-check-extension).
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
const { addAgencyListedCardsAction, agencyCheckAction } = await import("./agency-check-actions");

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
});

/**
 * **The page's other cards, filed as pending** (layer 3). After a match the
 * staffer is offered the diver's nitrox and specialty cards the same page
 * lists. The server believes only the page's text and the ticks, and the
 * ticks only where the page, judged again, offers them.
 */
describe("addAgencyListedCardsAction", () => {
  const LISTING = `${NAUI_PAGE}\nEnriched Air Nitrox Diver\nDeep Diver`;

  function add(certificationId: string, pageText: string, kinds: readonly string[]) {
    const formData = check(certificationId, pageText);
    for (const kind of kinds) formData.append("kind", kind);
    return formData;
  }

  async function checked(pageText = LISTING) {
    const ctxValues = await context();
    const card = await pendingCard(ctxValues.db, ctxValues.shop.id, ctxValues.personId);
    const result = await agencyCheckAction(
      ctxValues.shop.slug,
      ctxValues.personId,
      null,
      check(card.id, pageText),
    );
    return { ...ctxValues, card, result };
  }

  async function filed(db: AppDb, personId: string) {
    const nitrox = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.personId, personId));
    const specialties = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, personId));
    return { nitrox, specialties };
  }

  it("offers the page's other cards with the match, in the agency's words", async () => {
    const { result } = await checked();
    expect(result).toMatchObject({
      ok: true,
      verdict: "match",
      offers: [
        { kind: "nitrox", words: "Enriched Air Nitrox Diver" },
        { kind: "deep", words: "Deep Diver" },
      ],
    });
    // Nothing is filed until the staffer ticks it.
  });

  it("files the ticked cards as pending, with the agency's words and the diver's number", async () => {
    const { db, shop, owner, personId, card } = await checked();

    const result = await addAgencyListedCardsAction(
      shop.slug,
      personId,
      null,
      add(card.id, LISTING, ["nitrox", "deep"]),
    );

    expect(result).toEqual({ ok: true, added: ["nitrox", "deep"] });
    const { nitrox, specialties } = await filed(db, personId);
    expect(nitrox).toHaveLength(1);
    expect(specialties).toHaveLength(1);
    for (const row of [...nitrox, ...specialties]) {
      expect(row.status).toBe("pending");
      expect(row.agency).toBe("naui");
      expect(row.identifier).toBe(card.identifier);
      expect(row.reviewNote).toContain("Lena Ortiz");
      expect(row.reviewedAt).toBeNull();
    }
    expect(nitrox[0]?.reviewNote).toContain("Enriched Air Nitrox Diver");
    expect(specialties[0]?.specialty).toBe("deep");

    // The staffer's one tap certifies it and keeps the agency's words.
    const nitroxId = nitrox[0]?.id as string;
    const confirmed = await reviewNitroxCertification(db, {
      shopId: shop.id,
      certificationId: nitroxId,
      status: "verified",
      reviewedByPersonId: owner,
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.ok && confirmed.certification.reviewNote).toContain(
      "Enriched Air Nitrox Diver",
    );
  });

  it("files only what was ticked", async () => {
    const { db, shop, personId, card } = await checked();
    await addAgencyListedCardsAction(shop.slug, personId, null, add(card.id, LISTING, ["deep"]));
    const { nitrox, specialties } = await filed(db, personId);
    expect(nitrox).toHaveLength(0);
    expect(specialties.map((row) => row.specialty)).toEqual(["deep"]);
  });

  /** Security: a forged tick never makes a card the page did not show. */
  it("refuses a tick for a card the page does not list, and files none of the rest", async () => {
    const { db, shop, personId, card } = await checked();
    for (const kinds of [["wreck"], ["deep", "wreck"], ["cavern", "nitrox"]]) {
      expect(
        await addAgencyListedCardsAction(shop.slug, personId, null, add(card.id, LISTING, kinds)),
      ).toEqual({ ok: false });
    }
    // Page text rewritten to list a card: the judge reads it, but a page that
    // no longer matches offers nothing.
    expect(
      await addAgencyListedCardsAction(
        shop.slug,
        personId,
        null,
        add(card.id, "Lena Ortiz\n1987-09-03\nAdvanced Scuba Diver\nWreck Diver", ["wreck"]),
      ),
    ).toEqual({ ok: false });
    // A neighbour's cards under the diver's record are not the diver's.
    expect(
      await addAgencyListedCardsAction(
        shop.slug,
        personId,
        null,
        add(card.id, `${NAUI_PAGE}\nMark Lee\nWreck Diver`, ["wreck"]),
      ),
    ).toEqual({ ok: false });
    expect(await filed(db, personId)).toEqual({ nitrox: [], specialties: [] });
  });

  it("refuses a kind that is not a card, a repeated tick, or no tick at all", async () => {
    const { db, shop, personId, card } = await checked();
    for (const kinds of [["specialty:nitrox"], ["rescue"], ["deep", "deep"], []]) {
      expect(
        await addAgencyListedCardsAction(shop.slug, personId, null, add(card.id, LISTING, kinds)),
      ).toEqual({ ok: false });
    }
    expect(await filed(db, personId)).toEqual({ nitrox: [], specialties: [] });
  });

  it("never offers or files a card the diver already holds", async () => {
    const { db, shop, personId } = await context();
    await db.insert(nitroxCertifications).values({
      shopId: shop.id,
      personId,
      agency: "padi",
      identifier: "P-777",
      status: "verified",
    });
    const card = await pendingCard(db, shop.id, personId);
    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, LISTING));
    expect(result).toMatchObject({ offers: [{ kind: "deep", words: "Deep Diver" }] });

    expect(
      await addAgencyListedCardsAction(
        shop.slug,
        personId,
        null,
        add(card.id, LISTING, ["nitrox"]),
      ),
    ).toEqual({ ok: false });
    expect(
      await addAgencyListedCardsAction(shop.slug, personId, null, add(card.id, LISTING, ["deep"])),
    ).toEqual({ ok: true, added: ["deep"] });
    // A second post of the same tick finds the card on file.
    expect(
      await addAgencyListedCardsAction(shop.slug, personId, null, add(card.id, LISTING, ["deep"])),
    ).toEqual({ ok: false });
    const { nitrox, specialties } = await filed(db, personId);
    expect(nitrox).toHaveLength(1);
    expect(specialties).toHaveLength(1);
  });

  it("refuses a card no agency check certified, or one its Undo took back", async () => {
    const { db, shop, owner, personId } = await context();
    const byHand = await pendingCard(db, shop.id, personId, {
      status: "verified",
      reviewedAt: new Date("2026-10-01T00:00:00Z"),
      reviewedByPersonId: owner,
    });
    expect(
      await addAgencyListedCardsAction(
        shop.slug,
        personId,
        null,
        add(byHand.id, LISTING, ["deep"]),
      ),
    ).toEqual({ ok: false });

    const other = await diver(db, shop.id, "Lena Ortiz");
    const card = await pendingCard(db, shop.id, other);
    await agencyCheckAction(shop.slug, other, null, check(card.id, LISTING));
    await agencyCheckAction(shop.slug, other, null, check(card.id, null, "undo"));
    expect(
      await addAgencyListedCardsAction(shop.slug, other, null, add(card.id, LISTING, ["deep"])),
    ).toEqual({ ok: false });
    expect((await filed(db, other)).specialties).toEqual([]);
  });

  /** D1: the check's Undo takes back what its page filed, unless a staffer has since certified it. */
  it("takes back the cards it listed that still wait, when the check is undone", async () => {
    const { db, shop, owner, personId, card } = await checked();
    await addAgencyListedCardsAction(
      shop.slug,
      personId,
      null,
      add(card.id, LISTING, ["nitrox", "deep"]),
    );
    const before = await filed(db, personId);
    for (const row of [...before.nitrox, ...before.specialties]) {
      expect(row.listedFromCertificationId).toBe(card.id);
    }
    const nitroxId = before.nitrox[0]?.id as string;
    await reviewNitroxCertification(db, {
      shopId: shop.id,
      certificationId: nitroxId,
      status: "verified",
      reviewedByPersonId: owner,
    });

    expect(
      await agencyCheckAction(shop.slug, personId, null, check(card.id, null, "undo")),
    ).toEqual({ ok: true, verdict: "undone" });

    const after = await filed(db, personId);
    expect(after.specialties[0]?.deletedAt).toBeInstanceOf(Date);
    expect(after.specialties[0]?.deletedByPersonId).toBe(owner);
    // Certified since by a staffer's own tap: theirs, and it stays.
    expect(after.nitrox[0]).toMatchObject({ status: "verified", deletedAt: null });
    expect((await cardRow(db, card.id))?.agencyCheckedAt).toBeNull();
  });

  /** S2: the level card is read again inside the write, so an Undo in between files nothing. */
  it("files nothing once the check is undone, even from an offer derived before it", async () => {
    const { db, shop, owner, personId, card } = await checked();
    await agencyCheckAction(shop.slug, personId, null, check(card.id, null, "undo"));
    expect(
      await addAgencyListedCards(db, {
        shopId: shop.id,
        personId,
        certificationId: card.id,
        filedByPersonId: owner,
        cards: [{ kind: "deep", evidence: "Lena Ortiz · Deep Diver", cardNumber: null }],
      }),
    ).toEqual({ ok: false });
    expect((await filed(db, personId)).specialties).toEqual([]);
  });

  /** D6: a diver's own unsighted nitrox tick is a claim, which the agency's card replaces. */
  it("offers nitrox over an unsighted self-declaration, and retires the claim when it is added", async () => {
    const { db, shop, owner, personId } = await context();
    const [claim] = await db
      .insert(nitroxCertifications)
      .values({
        shopId: shop.id,
        personId,
        agency: "other",
        status: "pending",
        selfDeclaredAt: new Date("2026-09-01T00:00:00Z"),
      })
      .returning();
    const card = await pendingCard(db, shop.id, personId);
    const result = await agencyCheckAction(shop.slug, personId, null, check(card.id, LISTING));
    expect(result).toMatchObject({ offers: [{ kind: "nitrox" }, { kind: "deep" }] });

    expect(
      await addAgencyListedCardsAction(
        shop.slug,
        personId,
        null,
        add(card.id, LISTING, ["nitrox"]),
      ),
    ).toEqual({ ok: true, added: ["nitrox"] });
    const { nitrox } = await filed(db, personId);
    const retired = nitrox.find((row) => row.id === claim?.id);
    expect(retired?.deletedAt).toBeInstanceOf(Date);
    expect(retired?.deletedByPersonId).toBe(owner);
    const live = nitrox.filter((row) => row.deletedAt === null);
    expect(live).toMatchObject([
      { agency: "naui", identifier: card.identifier, listedFromCertificationId: card.id },
    ]);
  });

  /**
   * D2: SDI numbers each card. A listed card takes the number on its own line,
   * or none, and then its confirm is the card sighting.
   */
  it("takes each card's own number where the agency numbers each card, or none", async () => {
    const { db, shop, owner, personId } = await context();
    const card = await pendingCard(db, shop.id, personId, {
      agency: "sdi",
      identifier: "SDI-1001",
    });
    const page = [
      "Lena Ortiz",
      "04/12/1990",
      "Advanced Diver SDI-1001",
      "Computer Nitrox Diver 03/02/2019",
      "Deep Diver 778899",
    ].join("\n");
    expect(await agencyCheckAction(shop.slug, personId, null, check(card.id, page))).toMatchObject({
      verdict: "match",
      offers: [{ kind: "nitrox" }, { kind: "deep" }],
    });
    expect(
      await addAgencyListedCardsAction(
        shop.slug,
        personId,
        null,
        add(card.id, page, ["nitrox", "deep"]),
      ),
    ).toEqual({ ok: true, added: ["nitrox", "deep"] });
    const { nitrox, specialties } = await filed(db, personId);
    expect(nitrox[0]?.identifier).toBeNull();
    expect(specialties[0]?.identifier).toBe("778899");

    const nitroxId = nitrox[0]?.id as string;
    expect(
      await reviewNitroxCertification(db, {
        shopId: shop.id,
        certificationId: nitroxId,
        status: "verified",
        reviewedByPersonId: owner,
      }),
    ).toEqual({ ok: false, reason: "card_sighting_required" });
    const sighted = await reviewNitroxCertification(db, {
      shopId: shop.id,
      certificationId: nitroxId,
      status: "verified",
      reviewedByPersonId: owner,
      sighting: { agency: "sdi", identifier: "SDI-5005" },
    });
    expect(sighted.ok && sighted.certification.identifier).toBe("SDI-5005");
    // A number that may be a sighting is not taken back by a status flip.
    expect(
      await unreviewNitroxCertification(db, {
        shopId: shop.id,
        certificationId: nitroxId,
        reviewedAt: new Date(),
      }),
    ).toEqual({ ok: false, reason: "sighted_card" });
  });

  it("refuses another diver's card, and another shop's", async () => {
    const { db, shop, card } = await checked();
    const stranger = await diver(db, shop.id, "Lena Ortiz");
    expect(
      await addAgencyListedCardsAction(shop.slug, stranger, null, add(card.id, LISTING, ["deep"])),
    ).toEqual({ ok: false });

    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Reef Runners", slug: "reef-runners-listed", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("failed to insert a shop");
    const theirDiver = await diver(db, otherShop.id, "Lena Ortiz");
    const theirCard = await pendingCard(db, otherShop.id, theirDiver, {
      status: "verified",
      agencyCheckedAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(
      await addAgencyListedCardsAction(
        shop.slug,
        theirDiver,
        null,
        add(theirCard.id, LISTING, ["deep"]),
      ),
    ).toEqual({ ok: false });
    expect((await filed(db, stranger)).specialties).toEqual([]);
    expect((await filed(db, theirDiver)).specialties).toEqual([]);
  });
});
