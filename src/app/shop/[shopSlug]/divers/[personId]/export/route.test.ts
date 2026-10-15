import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { activityEvents, people, personRoles, shops } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * One diver's record as a ZIP (a subject-access answer). The gates, in order:
 * a malformed id is a 404 before anything is read; a staffer who may not
 * export the shop's data is a 403; a person who is not this shop's is a 404.
 * Only a delivered file leaves a `record_exported` line on the diver's trail.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
// No network from a unit test: the bundle's photos are fetched from storage.
vi.mock("@/lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export")>();
  return { ...actual, fetchExportPhotos: vi.fn(async () => []) };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { GET } = await import("./route");

const ctx = fileScopedShopContext();

function signIn(personId: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(requireStaffSession).mockResolvedValue(
    // An inflated role list: the gate must re-read the database, not the JWT.
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId, roles: ["owner"] }),
  );
}

async function seededDiverId(db: AppDb, shopId: string): Promise<string> {
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "diver")))
    .limit(1);
  if (!diver) throw new Error("seeded diver missing");
  return diver.id;
}

async function exportsOf(db: AppDb, personId: string) {
  return db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(
      and(eq(activityEvents.subjectPersonId, personId), eq(activityEvents.code, "record_exported")),
    );
}

function get(personId: string) {
  return GET(new Request("https://diveday.test/export"), {
    params: Promise.resolve({ shopSlug: ctx.shop.slug, personId }),
  });
}

describe("GET a diver's record export", () => {
  it("answers 404 to a malformed id before reading the session", async () => {
    vi.mocked(requireStaffSession).mockClear();
    const response = await get("not-a-uuid");
    expect(response.status).toBe(404);
    expect(requireStaffSession).not.toHaveBeenCalled();
  });

  it("refuses a captain with 403, and nothing is recorded", async () => {
    const { db, shop } = ctx;
    const diver = await seededDiverId(db, shop.id);
    signIn(await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL));

    const response = await get(diver);

    expect(response.status).toBe(403);
    expect(await exportsOf(db, diver)).toEqual([]);
  });

  it("answers 404 for another shop's person, and nothing is recorded", async () => {
    const { db, shop } = ctx;
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-diver-export", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const [stranger] = await db
      .insert(people)
      .values({ shopId: rival.id, fullName: "Rival Diver", email: "rival.diver@example.com" })
      .returning();
    if (!stranger) throw new Error("rival person insert failed");
    signIn(await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL));

    const response = await get(stranger.id);

    expect(response.status).toBe(404);
    expect(await exportsOf(db, stranger.id)).toEqual([]);
  });

  it("hands the owner a ZIP and records the export on the diver's trail", async () => {
    const { db, shop } = ctx;
    const diver = await seededDiverId(db, shop.id);
    signIn(await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL));

    const response = await get(diver);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await exportsOf(db, diver)).toHaveLength(1);
  });
});
