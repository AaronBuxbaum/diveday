import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { createNitroxCertification } from "@/db/nitrox";
import { addDiverNote, listDiverRecordNotes } from "@/db/operations";
import { createCertification, createSpecialtyCertification } from "@/db/readiness";
import {
  certifications,
  internalNotes,
  nitroxCertifications,
  people,
  specialtyCertifications,
} from "@/db/schema";
import { readUndoOffer } from "@/lib/undo";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

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
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
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

async function rowOf(db: AppDb, table: typeof certifications, id: string) {
  const [row] = await db.select().from(table).where(eq(table.id, id));
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
    const before = await rowOf(db, certifications, card.id);

    const removed = await redirectedTo(() =>
      deleteCertificationAction(shop.slug, personId, form({ certificationId: card.id })),
    );
    expect((await rowOf(db, certifications, card.id))?.deletedAt).not.toBeNull();
    const offer = offerFrom(removed);
    expect(offer).toEqual({
      undo: "diver-card",
      undoPerson: personId,
      undoCard: card.id,
      cardType: "level",
    });

    const landed = await undo(shop.slug, offer);

    expect(landed).toContain("notice=card-restored");
    const after = await rowOf(db, certifications, card.id);
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

    for (const [card, cardType, table] of [
      [specialty, "specialty", specialtyCertifications],
      [nitrox, "nitrox", nitroxCertifications],
    ] as const) {
      const [before] = await db.select().from(table).where(eq(table.id, card.id));
      const removed = await redirectedTo(() =>
        deleteSpecialtyAction(shop.slug, personId, form({ certificationId: card.id, cardType })),
      );
      const offer = offerFrom(removed);
      expect(offer).toMatchObject({ undo: "diver-card", undoCard: card.id, cardType });

      expect(await undo(shop.slug, offer)).toContain("notice=card-restored");
      const [after] = await db.select().from(table).where(eq(table.id, card.id));
      expect({ ...after, deletedByPersonId: before?.deletedByPersonId }).toEqual(before);
    }
  });

  it("a note: its exact text back on the same record, once", async () => {
    const { db, shop, owner, personId } = await context();
    const body = "Prefers the starboard bench; seasick on the 7am.";
    const note = await addDiverNote(db, { shopId: shop.id, personId, actorPersonId: owner, body });
    if (!note) throw new Error("note insert failed");

    const removed = await redirectedTo(() =>
      deleteDiverNoteAction(shop.slug, personId, form({ noteId: note.id })),
    );
    expect(await listDiverRecordNotes(db, shop.id, personId)).toEqual([]);
    const offer = offerFrom(removed);
    expect(offer).toEqual({ undo: "diver-note", undoPerson: personId, noteBody: body });

    expect(await undo(shop.slug, offer)).toContain("notice=note-added");
    const notes = await listDiverRecordNotes(db, shop.id, personId);
    expect(notes.map((row) => row.note.body)).toEqual([body]);
  });

  it("a note too long to offer back still deletes and lands, with no Undo rather than an error", async () => {
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
    expect(
      readUndoOffer(Object.fromEntries(new URL(landed, "https://dive.test").searchParams)),
    ).toBeNull();
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
    expect((await rowOf(db, certifications, card.id))?.deletedAt).not.toBeNull();
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
      "an empty note",
      { undo: "diver-note", undoPerson: "11111111-1111-4111-8111-111111111111", noteBody: "  " },
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
    expect((await rowOf(db, certifications, card.id))?.deletedAt).not.toBeNull();
  });

  it("never brings an erased diver's card or note text back", async () => {
    const { db, shop, personId } = await context();
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
      noteBody: "Text a URL carried after the erasure.",
    });

    expect(card_).toContain("notice=card-restore-conflict");
    expect(note).toContain("notice=invalid");
    expect((await rowOf(db, certifications, card.id))?.deletedAt).not.toBeNull();
    expect(await listDiverRecordNotes(db, shop.id, personId)).toEqual([]);
  });
});
