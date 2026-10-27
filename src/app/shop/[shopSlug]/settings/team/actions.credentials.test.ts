import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getSafetyMonth, getSafetyYear } from "@/db/safety-report";
import { people, personRoles, staffCredentials, tripAssignments, trips } from "@/db/schema";
import { shiftCalendarDate } from "@/lib/calendar-date";
import { lastDayOfDeparture } from "@/lib/crew-roles";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext({ history: true });

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { deleteStaffCredentialAction, saveStaffCredentialAction } = await import("./actions");

/**
 * Issue #2172: a pro rating with no renewal date reads as current, so one old
 * undated card kept a lapsed pro counted toward supervision. A rating is
 * added with its date or not at all; every other kind stays optional.
 */
async function setup() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  return { db, shop, captain };
}

function credentialForm(personId: string, kind: string, renewsAt: string): FormData {
  const form = new FormData();
  form.set("personId", personId);
  form.set("kind", kind);
  form.set("name", "Old card");
  form.set("issuingBody", "");
  form.set("identifier", "");
  form.set("issuedAt", "");
  form.set("renewsAt", renewsAt);
  return form;
}

async function savedFor(personId: string) {
  return ctx.db.select().from(staffCredentials).where(eq(staffCredentials.personId, personId));
}

describe("adding a staff credential", () => {
  for (const kind of ["instructor_rating", "divemaster_rating"]) {
    it(`refuses an undated ${kind}, and writes nothing`, async () => {
      const { shop, captain } = await setup();
      const before = await savedFor(captain);
      const to = await redirectedTo(() =>
        saveStaffCredentialAction(credentialForm(captain, kind, "")),
      );
      expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=credential-renewal-required`);
      expect(await savedFor(captain)).toEqual(before);
    });

    it(`saves a dated ${kind}`, async () => {
      const { shop, captain } = await setup();
      const before = await savedFor(captain);
      const to = await redirectedTo(() =>
        saveStaffCredentialAction(credentialForm(captain, kind, "2031-03-01")),
      );
      expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=credential-saved`);
      const beforeIds = new Set(before.map((row) => row.id));
      const added = (await savedFor(captain)).filter((row) => !beforeIds.has(row.id));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ kind, renewsAt: "2031-03-01" });
    });
  }

  it("still saves the other kinds without a renewal date", async () => {
    const { shop, captain } = await setup();
    const before = await savedFor(captain);
    for (const kind of [
      "assistant_instructor_rating",
      "first_aid_cpr",
      "captains_licence",
      "other",
    ]) {
      const to = await redirectedTo(() =>
        saveStaffCredentialAction(credentialForm(captain, kind, "")),
      );
      expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=credential-saved`);
    }
    const beforeIds = new Set(before.map((row) => row.id));
    const added = (await savedFor(captain)).filter((row) => !beforeIds.has(row.id));
    expect(added.map((row) => row.kind).sort()).toEqual(
      ["assistant_instructor_rating", "first_aid_cpr", "captains_licence", "other"].sort(),
    );
  });
});

describe("renewing a staff credential", () => {
  it("retains the card number and labels uncertain sailing evidence unavailable", async () => {
    const { db, shop } = await setup();
    const [sailing] = await db
      .select({ id: trips.id, endsAt: trips.endsAt })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          eq(trips.description, "Sailed. Kept in the log for the shop's monthly numbers."),
        ),
      )
      .limit(1);
    if (!sailing) throw new Error("expected a sailed history boat");
    const [member] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Renewal test" })
      .returning();
    if (!member) throw new Error("expected a staff member");
    await db.insert(personRoles).values({ personId: member.id, role: "captain" });
    await db
      .insert(tripAssignments)
      .values({ tripId: sailing.id, personId: member.id, tripRole: "captain" });
    const day = lastDayOfDeparture(sailing.endsAt, shop.timezone);
    vi.stubEnv("DIVEDAY_CLOCK", new Date(sailing.endsAt.getTime() - 2 * 86_400_000).toISOString());
    const oldForm = credentialForm(member.id, "captains_licence", shiftCalendarDate(day, -1));
    oldForm.set("identifier", "LICENCE-123");
    oldForm.set("issuedAt", shiftCalendarDate(day, -365));
    expect(await redirectedTo(() => saveStaffCredentialAction(oldForm))).toBe(
      `/shop/${shop.slug}/settings/team?notice=credential-saved`,
    );
    const [oldCard] = (await savedFor(member.id)).filter(
      (card) => card.identifier === "LICENCE-123",
    );
    if (!oldCard) throw new Error("expected the original licence");
    advanceClock(3 * 86_400_000);
    const from = new Date("2000-01-01T00:00:00Z");
    const to = new Date("2100-01-01T00:00:00Z");
    const before = await getSafetyMonth(db, shop.id, from, to, shop.timezone);
    expect(before.unknownCredentialSailings).toBeGreaterThan(0);
    expect(before.lapsedSailings.some((row) => row.personId === member.id)).toBe(false);

    const renewal = credentialForm(member.id, "captains_licence", shiftCalendarDate(day, 366));
    renewal.set("identifier", "LICENCE-123");
    renewal.set("issuedAt", shiftCalendarDate(day, 1));
    renewal.set("renewalOf", oldCard.id);
    renewal.set("revision", String(oldCard.revision));
    expect(await redirectedTo(() => saveStaffCredentialAction(renewal))).toBe(
      `/shop/${shop.slug}/settings/team?notice=credential-saved`,
    );
    const cards = (await savedFor(member.id)).filter((card) => card.identifier === "LICENCE-123");
    expect(cards.some((card) => card.renewsAt === shiftCalendarDate(day, 366))).toBe(true);
    const renewed = cards.find((card) => card.id === oldCard.id);
    if (!renewed) throw new Error("expected current licence");
    const correction = credentialForm(member.id, "captains_licence", shiftCalendarDate(day, 366));
    correction.set("identifier", "LICENCE-123");
    correction.set("issuedAt", shiftCalendarDate(day, -365));
    correction.set("correctionOf", oldCard.id);
    correction.set("revision", String(renewed.revision));
    expect(await redirectedTo(() => saveStaffCredentialAction(correction))).toBe(
      `/shop/${shop.slug}/settings/team?notice=credential-saved`,
    );
    const [corrected] = (await savedFor(member.id)).filter((card) => card.id === oldCard.id);
    if (!corrected) throw new Error("expected corrected licence");
    const deletion = new FormData();
    deletion.set("credentialId", oldCard.id);
    deletion.set("revision", String(corrected.revision));
    expect(await redirectedTo(() => deleteStaffCredentialAction(deletion))).toBe(
      `/shop/${shop.slug}/settings/team?notice=credential-deleted`,
    );
    const after = await getSafetyMonth(db, shop.id, from, to, shop.timezone);
    expect(after.unknownCredentialSailings).toBeGreaterThan(0);
    expect(after.lapsedSailings.some((row) => row.personId === member.id)).toBe(false);
    const year = await getSafetyYear(db, shop.id, Number(day.slice(0, 4)), shop.timezone);
    expect(year.unknownCredentialSailings).toBeGreaterThan(0);
    expect(year.lapsedSailings.some((row) => row.personId === member.id)).toBe(false);
  });
});
