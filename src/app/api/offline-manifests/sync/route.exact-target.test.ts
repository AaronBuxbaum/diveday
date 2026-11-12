import { describe, expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const fileCtx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { POST } = await import("./route");

function postRequest(body: unknown) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: { "x-diveday-roll-call-protocol": "1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function seededContext() {
  const { db, shop } = fileCtx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("fixture trip missing");
  const [row] = await getTripRoster(db, shop.id, trip.id);
  if (!row) throw new Error("fixture booking missing");
  const staffPersonId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, trip, booking: row.booking, staffPersonId };
}
function staffSession(shopId: string, personId: string): DiveDaySession {
  return {
    user: {
      shopId,
      personId,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: "staff@demo.invalid",
      roles: ["owner"],
    },
  };
}

describe("sync exact undo preserves independent evidence", () => {
  /**
   * The compare-and-set, from the outside (ADR
   * 20260815-an-offline-retraction-names-its-target). The route's only job here
   * is to carry `retractsClientEventId` through to the writer unaltered — it is
   * the one field on this body that decides whether a retraction is a
   * compare-and-set or a blind newest-wins write, and a schema that quietly
   * dropped it would leave every device-side and writer-side test green while
   * the property it exists for was gone.
   *
   * Two events, then a retraction of the *first*. On a boat that second event is
   * another crew member's phone, or the live manifest; here it is simply the
   * statement standing when the undo arrives.
   */
  it("carries an exact retraction target without taking back independent compatible evidence", async () => {
    const { db, shop, trip, booking, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));
    const now = nowDate().toISOString();
    const mine = crypto.randomUUID();
    const theirs = crypto.randomUUID();
    const event = (clientEventId: string, extra: Record<string, unknown> = {}) => ({
      clientEventId,
      snapshotId: crypto.randomUUID(),
      snapshotSavedAt: now,
      bookingId: booking.id,
      tripId: trip.id,
      checkpoint: "departure" as const,
      status: "not_boarded",
      meetingDay: 0,
      observedEvidenceIds: [],
      note: null,
      occurredAt: now,
      ...extra,
    });

    const applied = await POST(postRequest({ events: [event(mine), event(theirs)] }));
    expect(applied.status).toBe(200);
    expect((await applied.json()).results).toEqual([
      { clientEventId: mine, status: "applied" },
      { clientEventId: theirs, status: "applied" },
    ]);

    const retraction = crypto.randomUUID();
    const response = await POST(
      postRequest({
        events: [
          event(retraction, {
            status: "cleared",
            retractsClientEventId: mine,
            observedEvidenceIds: [`client:${mine}`],
          }),
        ],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ clientEventId: string; status: string; reason?: string }>;
    };
    expect(body.results).toEqual([{ clientEventId: retraction, status: "applied" }]);
    // The exact target was withdrawn; the independent same-result statement
    // survives. An arbitrary nonexistent target is still refused visibly.
    const unknown = crypto.randomUUID();
    const refused = await POST(
      postRequest({
        events: [event(unknown, { status: "cleared", retractsClientEventId: crypto.randomUUID() })],
      }),
    );
    expect((await refused.json()).results).toEqual([
      { clientEventId: unknown, status: "rejected", reason: "retraction_superseded" },
    ]);
    const manifest = await getTripManifest(db, shop.id, trip.id, "departure");
    const standing = manifest?.divers.find((entry) => entry.bookingId === booking.id);
    expect(standing?.rollCallContext).toMatchObject({
      meetingDay: 0,
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: `client:${theirs}`, status: "not_boarded" }),
      ]),
    });
    expect(standing).toMatchObject({ rollCall: { state: "not_boarded" } });
    expect(standing?.rollCallContext?.conflict).toBe(false);
    expect(standing?.rollCallContext?.observedEvidenceIds).toContain(`client:${theirs}`);
    expect(standing?.rollCallContext?.observedEvidenceIds).not.toContain(`client:${mine}`);
  });
});
