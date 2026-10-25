import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBoat } from "@/db/boats";
import { getIncidentExport } from "@/db/incident-export";
import {
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  tripAssignments,
  trips,
} from "@/db/schema";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`). Mocks as in `route.test.ts`.
const fileCtx = fileScopedShopContext();

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

function postRequest(body: unknown) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seededContext() {
  const { db, shop } = fileCtx;
  const staffPersonId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, staffPersonId };
}

const staffSession = (shopId: string, personId: string): DiveDaySession => ({
  user: {
    personId,
    shopId,
    shopSlug: "blue-mantis",
    name: "Dana Reyes",
    email: "staff@demo.invalid",
    roles: ["owner"],
  },
});

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

/**
 * **The departure log's checklist answer, after an offline sync** (issue 2725,
 * review 2 B1/B2). The dock has no signal: the crew checks lines and counts
 * heads offline, and the tablet syncs after the boat has left. The log's
 * "checked at the departure roll call" answer must read the taps made at or
 * before the count, whatever order they reach the server in: this route
 * applies every roll-call event before any checklist event, and a clear can
 * arrive in a later sync still.
 */
describe("POST /api/offline-manifests/sync — the checklist answer on the departure log", () => {
  it("counts checks and clears made before the count, from one body and from a late sync", async () => {
    const { db, shop, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));
    const now = nowDate().getTime();
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);

    const boat = await createBoat(db, shop.id, "Sync Hull 2725", 12, null);
    const [trip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        boatId: boat.id,
        title: "Sync departure 2725",
        // Sailed half an hour ago; the tablet only now finds signal.
        startsAt: at(30),
        endsAt: new Date(now + 3 * 3_600_000),
        capacity: 10,
      })
      .returning();
    if (!trip) throw new Error("trip insert failed");
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: staffPersonId });
    const [oxygen, flares, radio] = await db
      .insert(preDepartureChecklistItems)
      .values(
        ["2725 oxygen aboard", "2725 flares in date", "2725 radio checked"].map(
          (label, sortOrder) => ({
            shopId: shop.id,
            label,
            sortOrder: 2000 + sortOrder,
            createdAt: at(240),
          }),
        ),
      )
      .returning();
    if (!oxygen || !flares || !radio) throw new Error("items missing");
    // Checked online before the signal dropped.
    await db.insert(preDepartureCheckEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      checklistItemId: radio.id,
      recordedByPersonId: staffPersonId,
      status: "checked",
      occurredAt: at(70),
    });

    const savedAt = at(65).toISOString();
    const offline = { snapshotId: crypto.randomUUID(), snapshotSavedAt: savedAt, tripId: trip.id };
    const tap = (checklistItemId: string, status: "checked" | "cleared", minutesAgo: number) => ({
      ...offline,
      clientEventId: crypto.randomUUID(),
      checklistItemId,
      status,
      note: null,
      occurredAt: at(minutesAgo).toISOString(),
    });
    const first = await POST(
      postRequest({
        events: [
          {
            ...offline,
            clientEventId: crypto.randomUUID(),
            crewPersonId: staffPersonId,
            checkpoint: "departure",
            status: "boarded",
            note: null,
            occurredAt: at(40).toISOString(),
          },
        ],
        checklistEvents: [
          tap(oxygen.id, "checked", 50),
          tap(flares.id, "checked", 50),
          // The radio was found dead and taken back, offline, before the count.
          tap(radio.id, "cleared", 45),
        ],
      }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { results: Array<{ status: string }> };
    expect(firstBody.results.map((result) => result.status)).toEqual([
      "applied",
      "applied",
      "applied",
      "applied",
    ]);

    const ours = async () => {
      const doc = await getIncidentExport(db, shop.id, trip.id, staffPersonId);
      const answer = doc?.boatSafety?.checklist;
      return {
        unchecked: (answer?.unchecked ?? []).filter((label) => label.startsWith("2725")),
        checked: (answer?.itemCount ?? 0) - (answer?.unchecked.length ?? 0),
      };
    };
    expect(await ours()).toMatchObject({ unchecked: ["2725 radio checked"] });

    // A second device syncs later still: the flares were cleared before the count.
    const late = await POST(
      postRequest({ events: [], checklistEvents: [tap(flares.id, "cleared", 42)] }),
    );
    expect(late.status).toBe(200);
    expect((await ours()).unchecked).toEqual(["2725 flares in date", "2725 radio checked"]);
  });
});
