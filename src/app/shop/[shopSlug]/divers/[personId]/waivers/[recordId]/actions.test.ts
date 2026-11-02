import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents, bookings, personRoles, waiverRecords } from "@/db/schema";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import {
  demoteOwnerToManager,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// The real writer, wrapped so one test can make the trail refuse the line.
vi.mock("@/db/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/operations")>();
  return { ...actual, recordDiverActivity: vi.fn(actual.recordDiverActivity) };
});
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { recordDiverActivity } = await import("@/db/operations");
const { showMedicalAnswersAction, showMedicalAlertOnRecordAction } = await import("./actions");

const ctx = fileScopedShopContext();

/**
 * **Who read a diver's medical questionnaire** (issue #2157). The full
 * answers leave the server only through "Show answers", which puts the
 * reader on the diver's trail first, and only for an owner or manager.
 */
async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  // A signed release on a seat nobody holds (H-20260724-one-person-per-email), given a questionnaire:
  // the seed signs its releases without one.
  const [record] = await db
    .select({ id: waiverRecords.id, personId: waiverRecords.personId })
    .from(waiverRecords)
    .innerJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
    .where(
      and(
        eq(waiverRecords.shopId, shop.id),
        eq(waiverRecords.status, "completed"),
        isNull(bookings.identityUnconfirmedAt),
      ),
    )
    .limit(1);
  if (!record) throw new Error("expected a seeded signed release");
  await db
    .update(waiverRecords)
    .set({ medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE) })
    .where(eq(waiverRecords.id, record.id));
  return {
    db,
    shop,
    record,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

async function readLines(db: Awaited<ReturnType<typeof context>>["db"], personId: string) {
  return db
    .select({ actor: activityEvents.actorPersonId })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.subjectPersonId, personId),
        eq(activityEvents.code, "medical_answers_read"),
      ),
    );
}

describe("showMedicalAnswersAction", () => {
  it("records who read the answers, then hands them over", async () => {
    const { db, shop, record, owner } = await context();
    signIn(shop, owner);

    const result = await showMedicalAnswersAction(shop.slug, record.personId, record.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers.length).toBeGreaterThan(0);
    expect(await readLines(db, record.personId)).toEqual([{ actor: owner }]);
  });

  it("writes a line for every read, not one per diver", async () => {
    const { db, shop, record, owner } = await context();
    signIn(shop, owner);

    await showMedicalAnswersAction(shop.slug, record.personId, record.id);
    await showMedicalAnswersAction(shop.slug, record.personId, record.id);

    expect(await readLines(db, record.personId)).toHaveLength(2);
  });

  it("hands the answers to a manager who is not the owner", async () => {
    const { db, shop, record, owner } = await context();
    await demoteOwnerToManager(db, owner);
    try {
      signIn(shop, owner);

      const result = await showMedicalAnswersAction(shop.slug, record.personId, record.id);

      expect(result.ok).toBe(true);
      expect(await readLines(db, record.personId)).toContainEqual({ actor: owner });
    } finally {
      await db.insert(personRoles).values({ personId: owner, role: "owner" });
    }
  });

  /**
   * The line is not swallowed: when the trail cannot take it (the reader was
   * removed between the role check and the write, say), no answer is shown.
   */
  it("shows nothing when the read cannot be put on the trail", async () => {
    const { db, shop, record, owner } = await context();
    signIn(shop, owner);
    const before = await readLines(db, record.personId);
    vi.mocked(recordDiverActivity).mockResolvedValueOnce(false);

    await expect(showMedicalAnswersAction(shop.slug, record.personId, record.id)).resolves.toEqual({
      ok: false,
    });
    expect(recordDiverActivity).toHaveBeenCalled();
    expect(await readLines(db, record.personId)).toEqual(before);
  });

  it("refuses a role below manager and writes nothing", async () => {
    const { db, shop, record, captain } = await context();
    signIn(shop, captain);

    await expect(showMedicalAnswersAction(shop.slug, record.personId, record.id)).resolves.toEqual({
      ok: false,
    });
    expect(await readLines(db, record.personId)).toEqual([]);
  });

  it("refuses a release that is not this diver's, and writes nothing", async () => {
    const { db, shop, record, owner } = await context();
    signIn(shop, owner);

    await expect(showMedicalAnswersAction(shop.slug, owner, record.id)).resolves.toEqual({
      ok: false,
    });
    await expect(
      showMedicalAnswersAction(shop.slug, record.personId, "not-a-uuid"),
    ).resolves.toEqual({ ok: false });
    expect(await readLines(db, record.personId)).toEqual([]);
    expect(await readLines(db, owner)).toEqual([]);
  });

  it("refuses another shop's slug before reading anything", async () => {
    const { db, shop, record, owner } = await context();
    signIn(shop, owner);

    await expect(
      showMedicalAnswersAction("another-shop", record.personId, record.id),
    ).rejects.toThrow("NOT_FOUND");
    expect(await readLines(db, record.personId)).toEqual([]);
  });
});

/**
 * **"Show the alert" on the signed record** (issue #2960): owner and manager
 * only, and each read on the diver's trail before the words leave the server.
 */
describe("showMedicalAlertOnRecordAction", () => {
  const ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";

  async function alerted() {
    const base = await context();
    await base.db
      .update(waiverRecords)
      .set({ medicalAlert: ALERT })
      .where(eq(waiverRecords.id, base.record.id));
    return base;
  }

  async function alertLines(db: Awaited<ReturnType<typeof context>>["db"], personId: string) {
    return db
      .select({ actor: activityEvents.actorPersonId })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.subjectPersonId, personId),
          eq(activityEvents.code, "medical_alert_read"),
        ),
      );
  }

  it("records the read, then hands the owner the words", async () => {
    const { db, shop, record, owner } = await alerted();
    signIn(shop, owner);
    await expect(
      showMedicalAlertOnRecordAction(shop.slug, record.personId, record.id),
    ).resolves.toEqual({ ok: true, text: ALERT });
    expect(await alertLines(db, record.personId)).toEqual([{ actor: owner }]);
  });

  it("refuses a captain here, crew or not, and writes nothing", async () => {
    const { db, shop, record, captain } = await alerted();
    signIn(shop, captain);
    await expect(
      showMedicalAlertOnRecordAction(shop.slug, record.personId, record.id),
    ).resolves.toEqual({ ok: false });
    expect(await alertLines(db, record.personId)).toEqual([]);
  });

  it("shows nothing when the trail cannot take the line", async () => {
    const { db, shop, record, owner } = await alerted();
    signIn(shop, owner);
    vi.mocked(recordDiverActivity).mockResolvedValueOnce(false);
    await expect(
      showMedicalAlertOnRecordAction(shop.slug, record.personId, record.id),
    ).resolves.toEqual({ ok: false });
    expect(await alertLines(db, record.personId)).toEqual([]);
  });

  it("answers nothing for a release with no alert, or another diver's", async () => {
    const { db, shop, record, owner } = await context();
    signIn(shop, owner);
    await expect(
      showMedicalAlertOnRecordAction(shop.slug, record.personId, record.id),
    ).resolves.toEqual({ ok: false });
    await expect(showMedicalAlertOnRecordAction(shop.slug, owner, record.id)).resolves.toEqual({
      ok: false,
    });
    expect(await alertLines(db, record.personId)).toEqual([]);
  });
});
