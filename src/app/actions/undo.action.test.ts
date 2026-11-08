import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { createNitroxCertification } from "@/db/nitrox";
import { addDiverNote, listDiverRecordNotes } from "@/db/operations";
import { createCertification, createSpecialtyCertification } from "@/db/readiness";
import { activityEvents, cards, internalNotes, people } from "@/db/schema";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { readUndoOffer } from "../../features/undo/rules";

/**
 * **One Undo, three removals** (issue #2764). Each removal on the diver record
 * lands with an offer; the page posts that offer, unchanged, to the one
 * `undoAction`. These tests take the offer from the real landing URL (never a
 * hand-built one), post it, and read the row back: an Undo is only worth
 * having if what comes back is exactly what went.
 *
 * Then the other half: every field of the offer is a URL param a stranger can
 * type, so a post that names another shop, another kind, a field its kind does
 * not take, or a role the removal itself refuses is refused, and nothing moves.
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
vi.mock("../../features/session/rules", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../features/session/rules");
const { undoAction } = await import("./undo");
const { deleteCertificationAction, deleteSpecialtyAction } = await import(
  "@/app/shop/[shopSlug]/divers/[personId]/card-actions"
);
const { deleteDiverNoteAction } = await import(
  "@/app/shop/[shopSlug]/divers/[personId]/note-actions"
);
const { deletePersonAction } = await import(
  "@/app/shop/[shopSlug]/divers/[personId]/record-actions"
);

const ctx = fileScopedShopContext();

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  signIn(shop, owner);
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Undo Ula", email: "ula@example.com" })
    .returning();
  if (!person) throw new Error("failed to insert a diver");
  return { db, shop, owner, captain, personId: person.id };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** The offer a landing carried, as the page reads it and the toast posts it back. */
function offerFrom(landing: string): Record<string, string> {
  const params = Object.fromEntries(new URL(landing, "https://dive.test").searchParams);
  const offer = readUndoOffer(params);
  if (!offer) throw new Error(`the landing offered no Undo: ${landing}`);
  return { ...offer };
}

async function undo(slug: string, fields: Record<string, string>) {
  return redirectedTo(() => undoAction(slug, form(fields)));
}

async function rowOf(db: AppDb, id: string) {
  const [row] = await db.select().from(cards).where(eq(cards.id, id));
  return row;
}

describe("an Undo puts back exactly what was removed", () => {
  it("a level card: the same row, live again", async () => {
    const { db, shop, personId } = await context();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "advanced_open_water",
      identifier: "UNDO-L-1",
    });
    if (!card) throw new Error("card insert failed");
    const before = await rowOf(db, card.id);

    const removed = await redirectedTo(() =>
      deleteCertificationAction(shop.slug, personId, form({ certificationId: card.id })),
    );
    expect((await rowOf(db, card.id))?.deletedAt).not.toBeNull();
    const offer = offerFrom(removed);
    expect(offer).toEqual({
      undo: "diver-card",
      undoPerson: personId,
      undoCard: card.id,
      cardType: "level",
    });

    const landed = await undo(shop.slug, offer);

    expect(landed).toContain("notice=card-restored");
    const after = await rowOf(db, card.id);
    expect({ ...after, deletedByPersonId: before?.deletedByPersonId }).toEqual(before);
  });

  it("a specialty card and a nitrox card, each from its own table", async () => {
    const { db, shop, personId } = await context();
    const specialty = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      specialty: "deep",
      identifier: "UNDO-S-1",
    });
    const nitrox = await createNitroxCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      identifier: "UNDO-N-1",
    });
    if (!specialty || !nitrox) throw new Error("card insert failed");

    for (const [card, cardType] of [
      [specialty, "specialty"],
      [nitrox, "nitrox"],
    ] as const) {
      const before = await rowOf(db, card.id);
      const removed = await redirectedTo(() =>
        deleteSpecialtyAction(shop.slug, personId, form({ certificationId: card.id, cardType })),
      );
      const offer = offerFrom(removed);
      expect(offer).toMatchObject({ undo: "diver-card", undoCard: card.id, cardType });

      expect(await undo(shop.slug, offer)).toContain("notice=card-restored");
      const after = await rowOf(db, card.id);
      expect({ ...after, deletedByPersonId: before?.deletedByPersonId }).toEqual(before);
    }
  });

  /**
   * Issue #3701: the offer names the note, never its words. The delete is
   * soft, so the same row comes back, written by whoever wrote it.
   */
  it("a note: the same row back on the same record, by its id", async () => {
    const { db, shop, owner, personId } = await context();
    const body = "Prefers the starboard bench; seasick on the 7am.";
    const note = await addDiverNote(db, { shopId: shop.id, personId, actorPersonId: owner, body });
    if (!note) throw new Error("note insert failed");
    const [before] = await db.select().from(internalNotes).where(eq(internalNotes.id, note.id));

    const removed = await redirectedTo(() =>
      deleteDiverNoteAction(shop.slug, personId, form({ noteId: note.id })),
    );
    expect(await listDiverRecordNotes(db, shop.id, personId)).toEqual([]);
    const [kept] = await db.select().from(internalNotes).where(eq(internalNotes.id, note.id));
    expect(kept?.deletedAt).not.toBeNull();
    const offer = offerFrom(removed);
    expect(offer).toEqual({ undo: "diver-note", undoPerson: personId, undoNote: note.id });
    expect(removed).not.toContain("starboard");

    expect(await undo(shop.slug, offer)).toContain("notice=note-restored");
    const [after] = await db.select().from(internalNotes).where(eq(internalNotes.id, note.id));
    expect(after).toEqual(before);
  });

  it("a note longer than a typed one still offers its Undo, by id", async () => {
    const { db, shop, personId } = await context();
    // Imported notes carry no length bound; a typed one stops at 1,000.
    const [note] = await db
      .insert(internalNotes)
      .values({ shopId: shop.id, personId, body: "x".repeat(1_001), createdByPersonId: personId })
      .returning();
    if (!note) throw new Error("note insert failed");

    const landed = await redirectedTo(() =>
      deleteDiverNoteAction(shop.slug, personId, form({ noteId: note.id })),
    );

    expect(landed).toContain("notice=note-deleted");
    expect(await undo(shop.slug, offerFrom(landed))).toContain("notice=note-restored");
    expect(await listDiverRecordNotes(db, shop.id, personId)).toHaveLength(1);
  });

  it("a removed diver: back on the roster, the toast's Undo landing on the roster", async () => {
    const { db, shop, personId } = await context();
    const [before] = await db.select().from(people).where(eq(people.id, personId));

    const removed = await redirectedTo(() => deletePersonAction(shop.slug, personId, form({})));
    const offer = offerFrom(removed);
    expect(offer).toEqual({ undo: "diver-removal", undoPerson: personId, undoFrom: "roster" });

    expect(await undo(shop.slug, offer)).toBe(`/shop/${shop.slug}/divers?notice=restored`);
    const [after] = await db.select().from(people).where(eq(people.id, personId));
    expect(after).toEqual(before);
  });

  it("a removed diver restored from the record's own card lands on the record", async () => {
    const { db, shop, personId } = await context();
    await redirectedTo(() => deletePersonAction(shop.slug, personId, form({})));

    const landed = await undo(shop.slug, {
      undo: "diver-removal",
      undoPerson: personId,
      undoFrom: "record",
    });

    expect(landed).toBe(`/shop/${shop.slug}/divers/${personId}?notice=restored`);
    const [after] = await db.select().from(people).where(eq(people.id, personId));
    expect(after?.deletedAt).toBeNull();
  });
});

describe("an Undo is an endpoint, so every field of it is refused when it is wrong", () => {
  it("refuses another shop's slug before reading the offer", async () => {
    const { db, shop, personId } = await context();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "UNDO-X-1",
    });
    if (!card) throw new Error("card insert failed");
    const removed = await redirectedTo(() =>
      deleteCertificationAction(shop.slug, personId, form({ certificationId: card.id })),
    );

    await expect(undoAction("another-shop", form(offerFrom(removed)))).rejects.toThrow("NOT_FOUND");
    expect((await rowOf(db, card.id))?.deletedAt).not.toBeNull();
  });

  it.each([
    ["no kind", { undoPerson: "11111111-1111-4111-8111-111111111111" }],
    ["an unknown kind", { undo: "booking", undoPerson: "11111111-1111-4111-8111-111111111111" }],
    ["a malformed person", { undo: "diver-removal", undoPerson: "../x", undoFrom: "roster" }],
    [
      "a field its kind does not take",
      {
        undo: "diver-removal",
        undoPerson: "11111111-1111-4111-8111-111111111111",
        undoFrom: "roster",
        undoCard: "22222222-2222-4222-8222-222222222222",
      },
    ],
    [
      "a card type no table holds",
      {
        undo: "diver-card",
        undoPerson: "11111111-1111-4111-8111-111111111111",
        undoCard: "22222222-2222-4222-8222-222222222222",
        cardType: "medical",
      },
    ],
    [
      "a note's text instead of its id",
      {
        undo: "diver-note",
        undoPerson: "11111111-1111-4111-8111-111111111111",
        noteBody: "Words the URL's author chose.",
      },
    ],
  ])("refuses an offer with %s as no such page", async (_label, fields) => {
    const { shop } = await context();
    await expect(undoAction(shop.slug, form(fields as Record<string, string>))).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("refuses to restore a removed diver for a role the removal itself refuses", async () => {
    const { db, shop, captain, personId } = await context();
    await redirectedTo(() => deletePersonAction(shop.slug, personId, form({})));
    signIn(shop, captain);

    const fromRoster = await undo(shop.slug, {
      undo: "diver-removal",
      undoPerson: personId,
      undoFrom: "roster",
    });
    const fromRecord = await undo(shop.slug, {
      undo: "diver-removal",
      undoPerson: personId,
      undoFrom: "record",
    });

    expect(fromRoster).toBe(`/shop/${shop.slug}/divers?notice=not-authorized`);
    expect(fromRecord).toContain("notice=not-authorized-delete");
    const [after] = await db.select().from(people).where(eq(people.id, personId));
    expect(after?.deletedAt).not.toBeNull();
  });

  it("refuses a card offer that names one diver's record and another diver's card", async () => {
    const { db, shop, personId } = await context();
    const [other] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Other Otto", email: "otto@example.com" })
      .returning();
    if (!other) throw new Error("failed to insert a diver");
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: other.id,
      agency: "padi",
      level: "open_water",
      identifier: "UNDO-T-1",
    });
    if (!card) throw new Error("card insert failed");
    await redirectedTo(() =>
      deleteCertificationAction(shop.slug, other.id, form({ certificationId: card.id })),
    );

    const landed = await undo(shop.slug, {
      undo: "diver-card",
      undoPerson: personId,
      undoCard: card.id,
      cardType: "level",
    });

    expect(landed).toContain("notice=card-restore-conflict");
    expect((await rowOf(db, card.id))?.deletedAt).not.toBeNull();
  });

  it("never brings an erased diver's card or note back", async () => {
    const { db, shop, owner, personId } = await context();
    const written = await addDiverNote(db, {
      shopId: shop.id,
      personId,
      actorPersonId: owner,
      body: "Kept until the erasure.",
    });
    if (!written) throw new Error("note insert failed");
    const noteId = written.id;
    await redirectedTo(() => deleteDiverNoteAction(shop.slug, personId, form({ noteId })));
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "open_water",
      identifier: "UNDO-E-1",
    });
    if (!card) throw new Error("card insert failed");
    await redirectedTo(() =>
      deleteCertificationAction(shop.slug, personId, form({ certificationId: card.id })),
    );
    const erasedAt = new Date();
    await db
      .update(people)
      .set({ deletedAt: erasedAt, anonymizedAt: erasedAt })
      .where(eq(people.id, personId));

    const card_ = await undo(shop.slug, {
      undo: "diver-card",
      undoPerson: personId,
      undoCard: card.id,
      cardType: "level",
    });
    const note = await undo(shop.slug, {
      undo: "diver-note",
      undoPerson: personId,
      undoNote: noteId,
    });

    expect(card_).toContain("notice=card-restore-conflict");
    expect(note).toContain("notice=invalid");
    expect((await rowOf(db, card.id))?.deletedAt).not.toBeNull();
    expect(await listDiverRecordNotes(db, shop.id, personId)).toEqual([]);
  });
});

/**
 * Issue #3701 (Aaron, 2026-11-03): a card's Undo puts back only a card a
 * staffer deleted by hand in the last 15 minutes. Anything older, and any card
 * the system archived (an agency check taken back, a self-declared claim a
 * sighted card replaced), is re-entered and sighted instead, because a typed
 * URL could otherwise put a wrong card back `verified`. Every restore is
 * written to the activity log under the staffer who tapped it.
 */
describe("a card's Undo is bounded to a recent staff delete", () => {
  async function deletedLevelCard(identifier: string) {
    const base = await context();
    const { db, shop, personId } = base;
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "advanced_open_water",
      identifier,
    });
    if (!card) throw new Error("card insert failed");
    const removed = await redirectedTo(() =>
      deleteCertificationAction(shop.slug, personId, form({ certificationId: card.id })),
    );
    return { ...base, cardId: card.id, offer: offerFrom(removed) };
  }

  async function deletedMinutesAgo(db: AppDb, cardId: string, minutes: number) {
    await db
      .update(cards)
      .set({ deletedAt: new Date(nowMs() - minutes * MINUTE_MS) })
      .where(eq(cards.id, cardId));
  }

  it("restores a card deleted 14 minutes ago", async () => {
    const { db, shop, cardId, offer } = await deletedLevelCard("UNDO-W-1");
    await deletedMinutesAgo(db, cardId, 14);

    expect(await undo(shop.slug, offer)).toContain("notice=card-restored");
    expect((await rowOf(db, cardId))?.deletedAt).toBeNull();
  });

  it("answers a double-tapped Undo with its own notice, never the number conflict", async () => {
    const { db, shop, cardId, offer } = await deletedLevelCard("UNDO-W-3");

    expect(await undo(shop.slug, offer)).toContain("notice=card-restored");
    const second = await undo(shop.slug, offer);
    expect(second).toContain("notice=card-restore-gone");
    expect(second).not.toContain("card-restore-conflict");
    expect((await rowOf(db, cardId))?.deletedAt).toBeNull();
  });

  it("refuses a card deleted 16 minutes ago, with its own notice", async () => {
    const { db, shop, cardId, offer } = await deletedLevelCard("UNDO-W-2");
    await deletedMinutesAgo(db, cardId, 16);

    expect(await undo(shop.slug, offer)).toContain("notice=card-restore-expired");
    expect((await rowOf(db, cardId))?.deletedAt).not.toBeNull();
  });

  it("refuses a card the system archived, even a moment ago and stamped with a staffer", async () => {
    const { db, shop, owner, personId } = await context();
    for (const [cardType, create] of [
      [
        "level",
        () =>
          createCertification(db, {
            shopId: shop.id,
            personId,
            agency: "padi",
            level: "rescue",
            identifier: "UNDO-SYS-L",
          }),
      ],
      [
        "specialty",
        () =>
          createSpecialtyCertification(db, {
            shopId: shop.id,
            personId,
            agency: "padi",
            specialty: "wreck",
            identifier: "UNDO-SYS-S",
          }),
      ],
      [
        "nitrox",
        () =>
          createNitroxCertification(db, {
            shopId: shop.id,
            personId,
            agency: "padi",
            identifier: "UNDO-SYS-N",
          }),
      ],
    ] as const) {
      const card = await create();
      if (!card) throw new Error("card insert failed");
      // How an agency check taken back archives a card: now, under the
      // staffer who took it back, and never by the record's Delete.
      await db
        .update(cards)
        .set({ deletedAt: new Date(nowMs()), deletedByPersonId: owner })
        .where(eq(cards.id, card.id));

      const landed = await undo(shop.slug, {
        undo: "diver-card",
        undoPerson: personId,
        undoCard: card.id,
        cardType,
      });

      expect(landed).toContain("notice=card-restore-system");
      expect((await rowOf(db, card.id))?.deletedAt).not.toBeNull();
    }
  });

  it("writes the restore to the activity log, under the staffer who tapped Undo", async () => {
    const { db, shop, captain, personId, cardId, offer } = await deletedLevelCard("UNDO-W-3");
    signIn(shop, captain);

    expect(await undo(shop.slug, offer)).toContain("notice=card-restored");
    const lines = await db
      .select({
        actor: activityEvents.actorPersonId,
        subject: activityEvents.subjectPersonId,
        params: activityEvents.params,
      })
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, shop.id), eq(activityEvents.code, "card_restored")));
    expect(lines).toEqual([
      {
        actor: captain,
        subject: personId,
        params: { actor: expect.any(String), diver: "Undo Ula", cardType: "level" },
      },
    ]);
    expect((await rowOf(db, cardId))?.deletedAt).toBeNull();
  });

  it("writes nothing to the log for a refused restore", async () => {
    const { db, shop, cardId, offer } = await deletedLevelCard("UNDO-W-4");
    await deletedMinutesAgo(db, cardId, 60);

    await undo(shop.slug, offer);
    const lines = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, shop.id), eq(activityEvents.code, "card_restored")));
    expect(lines).toEqual([]);
  });
});

describe("a note's Undo names a note of this record, by id", () => {
  it("refuses a note id from another diver's record, and leaves it deleted", async () => {
    const { db, shop, owner, personId } = await context();
    const [other] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Other Olga", email: "olga@example.com" })
      .returning();
    if (!other) throw new Error("failed to insert a diver");
    const note = await addDiverNote(db, {
      shopId: shop.id,
      personId: other.id,
      actorPersonId: owner,
      body: "Olga's own note.",
    });
    if (!note) throw new Error("note insert failed");
    await redirectedTo(() => deleteDiverNoteAction(shop.slug, other.id, form({ noteId: note.id })));

    const landed = await undo(shop.slug, {
      undo: "diver-note",
      undoPerson: personId,
      undoNote: note.id,
    });

    expect(landed).toContain("notice=invalid");
    expect(await listDiverRecordNotes(db, shop.id, other.id)).toEqual([]);
    expect(await listDiverRecordNotes(db, shop.id, personId)).toEqual([]);
  });

  it("refuses a note that was never deleted, and writes nothing", async () => {
    const { db, shop, owner, personId } = await context();
    const note = await addDiverNote(db, {
      shopId: shop.id,
      personId,
      actorPersonId: owner,
      body: "Still here.",
    });
    if (!note) throw new Error("note insert failed");

    expect(
      await undo(shop.slug, { undo: "diver-note", undoPerson: personId, undoNote: note.id }),
    ).toContain("notice=invalid");
    expect(await listDiverRecordNotes(db, shop.id, personId)).toHaveLength(1);
  });
});
