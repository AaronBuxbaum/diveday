import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents, bookings, waiverRecords } from "@/db/schema";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import {
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
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { showMedicalAnswersAction } = await import("./actions");

const ctx = fileScopedShopContext();

/**
 * **Who read a diver's medical questionnaire** (issue #2157). The full
 * answers leave the server only through "Show answers", which puts the
 * reader on the diver's trail first, and only for an owner or manager.
 */
async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  // A signed release on a seat nobody holds (H-13), given a questionnaire:
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
