import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { standingReleaseByBooking } from "@/db/medical-alerts";
import { listTripReadiness } from "@/db/readiness";
import {
  activityEvents,
  people,
  personRoles,
  tripAssignments,
  trips,
  userAccounts,
  waiverRecords,
} from "@/db/schema";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import type { OfflineMedicalAlertsResponse } from "@/lib/offline-manifests";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const ctx = fileScopedShopContext();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const { POST } = await import("./route");

const ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";
const TITLE = "Two-Tank Reef — Molasses & French";

const session = (shopId: string, personId: string, roles: Role[]): DiveDaySession => ({
  user: {
    personId,
    shopId,
    shopSlug: "blue-mantis",
    name: "Staff",
    email: "staff@demo.invalid",
    roles,
  },
});

let seq = 0;
async function makeStaff(db: AppDb, shopId: string, roles: Role[]): Promise<string> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Alert Saver ${seq}` })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `alert.saver.${seq}@example.com`,
    hashedPassword: "x",
    status: "active",
  });
  return person.id;
}

/** An alert on one seat's standing release on the demo departure. */
async function alerted() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shop.id), eq(trips.title, TITLE)))
    .limit(1);
  if (!trip) throw new Error("demo departure missing");
  const releases = standingReleaseByBooking(await listTripReadiness(db, shop.id, trip.id));
  const [bookingId, recordId] = [...releases][0] ?? [];
  if (!bookingId || !recordId) throw new Error("expected a seat with a standing release");
  const [record] = await db
    .update(waiverRecords)
    .set({ medicalAlert: ALERT })
    .where(eq(waiverRecords.id, recordId))
    .returning({ personId: waiverRecords.personId });
  if (!record) throw new Error("expected the release");
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, tripId: trip.id, bookingId, diverId: record.personId, owner };
}

const call = (tripId: string, headers: Record<string, string> = {}) =>
  POST(
    new Request(`https://diveday.test/api/offline-manifests/${tripId}/medical-alerts`, {
      method: "POST",
      headers,
    }),
    { params: Promise.resolve({ tripId }) },
  );

async function savedLines(db: AppDb, diverId: string) {
  return db
    .select({ actor: activityEvents.actorPersonId, params: activityEvents.params })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.subjectPersonId, diverId),
        eq(activityEvents.code, "medical_alert_saved_offline"),
      ),
    );
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("POST /api/offline-manifests/[tripId]/medical-alerts (H-20261023-medical-alert-for-the amendment)", () => {
  it("hands the owner the words, records the save on the diver's trail and names who saved", async () => {
    const { db, shop, tripId, bookingId, diverId, owner } = await alerted();
    vi.mocked(auth).mockResolvedValue(session(shop.id, owner, ["owner"]));
    const response = await call(tripId);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as OfflineMedicalAlertsResponse;
    expect(body.texts).toEqual({ [bookingId]: ALERT });
    expect(body.savedBy.personId).toBe(owner);
    expect(body.savedBy.name).not.toBe("");
    const lines = await savedLines(db, diverId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.actor).toBe(owner);
    expect(lines[0]?.params.departure).toBe(tripId);
  });

  it("hands them to crew the owner or a manager put on the departure, and refuses crew who rostered themselves or whom an instructor rostered", async () => {
    const { db, shop, tripId, bookingId, diverId, owner } = await alerted();
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);
    vi.mocked(auth).mockResolvedValue(session(shop.id, divemaster, ["divemaster"]));
    // Not on the crew.
    expect((await call(tripId)).status).toBe(403);
    // On it by their own hand.
    await db
      .insert(tripAssignments)
      .values({ tripId, personId: divemaster, assignedByPersonId: divemaster });
    expect((await call(tripId)).status).toBe(403);
    // On it by an instructor's hand (security review 2, M-1): still refused.
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    await db
      .update(tripAssignments)
      .set({ assignedByPersonId: instructor })
      .where(and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, divemaster)));
    expect((await call(tripId)).status).toBe(403);
    expect(await savedLines(db, diverId)).toEqual([]);
    // Put there by the owner.
    await db
      .update(tripAssignments)
      .set({ assignedByPersonId: owner })
      .where(and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, divemaster)));
    const response = await call(tripId);
    expect(response.status).toBe(200);
    expect(((await response.json()) as OfflineMedicalAlertsResponse).texts).toEqual({
      [bookingId]: ALERT,
    });
    expect((await savedLines(db, diverId)).map((line) => line.actor)).toEqual([divemaster]);
  });

  it("refuses no session, a non-uuid departure and another shop's departure, writing nothing", async () => {
    const { db, shop, tripId, diverId, owner } = await alerted();
    vi.mocked(auth).mockResolvedValue(null);
    expect((await call(tripId)).status).toBe(401);
    vi.mocked(auth).mockResolvedValue(session(shop.id, owner, ["owner"]));
    expect((await call("not-a-uuid")).status).toBe(404);
    expect((await call("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect(await savedLines(db, diverId)).toEqual([]);
  });

  it("refuses a request from another origin before reading anything (security review 2, L5)", async () => {
    const { db, shop, tripId, diverId, owner } = await alerted();
    vi.mocked(auth).mockResolvedValue(session(shop.id, owner, ["owner"]));
    const refused: Record<string, string>[] = [
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of refused) {
      const response = await call(tripId, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(await savedLines(db, diverId)).toEqual([]);
    // The page's own fetch: same origin.
    const own = await call(tripId, {
      Origin: "https://diveday.test",
      "Sec-Fetch-Site": "same-origin",
    });
    expect(own.status).toBe(200);
  });
});
