import { describe, expect, it, vi } from "vitest";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "@/db/manifests";
import { createChecklistItem } from "@/db/pre-departure-check";
import { completeWaiver, issueWaiverRequest } from "@/db/waivers";
import type { DiveDaySession } from "@/lib/auth";
import { nowMs } from "@/lib/clock";
import { ROLL_CALL_CAUSAL_HEADERS } from "@/lib/roll-call-protocol";
import { advanceClock } from "@/test/clock";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import {
  clearAnswers,
  manifestContext,
} from "@/test/substrate-fixtures/db/manifests-test-fixtures";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { POST } = await import("./route");
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function request(body: unknown) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: { ...ROLL_CALL_CAUSAL_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Two actors exercised through the real route and database, not two physical devices.
describe("offline sync returns committed instants without inferring chronology", () => {
  it("returns committed times for checklist and arrival events and their retries", async () => {
    const { db, shop, reef, booking } = await manifestContext();
    const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue({
      user: {
        personId: actor,
        shopId: shop.id,
        shopSlug: shop.slug,
        name: "Owner",
        email: SEEDED_OWNER_EMAIL,
        roles: ["owner"],
      },
    } as DiveDaySession);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("waiver setup failed");
    await completeWaiver(db, issued.key, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    const item = await createChecklistItem(db, {
      shopId: shop.id,
      personId: actor,
      label: "Sync oxygen check",
    });
    if (!item.ok) throw new Error("checklist setup failed");
    const tappedAt = nowMs();
    const skew = 10 * MINUTE;
    advanceClock(2 * MINUTE);
    const common = {
      snapshotId: crypto.randomUUID(),
      tripId: reef.id,
      snapshotSavedAt: iso(tappedAt - 10 * MINUTE + skew),
      occurredAt: iso(tappedAt + skew),
    };
    const batch = {
      events: [],
      checklistEvents: [
        {
          ...common,
          clientEventId: crypto.randomUUID(),
          checklistItemId: item.id,
          status: "checked",
          note: null,
        },
      ],
      arrivalEvents: [
        {
          ...common,
          clientEventId: crypto.randomUUID(),
          bookingId: booking.booking.id,
          status: "arrived",
        },
      ],
    };
    const storedAt = nowMs();
    const first = await POST(request({ ...batch, includeStoredInstants: true }));
    expect((await first.json()).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientEventId: batch.checklistEvents[0].clientEventId,
          status: "applied",
          storedOccurredAt: iso(storedAt),
        }),
        expect.objectContaining({
          clientEventId: batch.arrivalEvents[0].clientEventId,
          status: "applied",
          storedOccurredAt: iso(storedAt),
        }),
      ]),
    );
    advanceClock(MINUTE);
    const retry = await POST(request({ ...batch, includeStoredInstants: true }));
    expect((await retry.json()).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientEventId: batch.checklistEvents[0].clientEventId,
          status: "duplicate",
          storedOccurredAt: iso(storedAt),
        }),
        expect.objectContaining({
          clientEventId: batch.arrivalEvents[0].clientEventId,
          status: "duplicate",
          storedOccurredAt: iso(storedAt),
        }),
      ]),
    );
    for (const changed of [{ status: "cleared" }, { note: "A different observation" }]) {
      const conflict = await POST(
        request({
          ...batch,
          checklistEvents: [{ ...batch.checklistEvents[0], ...changed }],
        }),
      );
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({ error: "client_event_conflict" });
    }
  });
  for (const subject of ["diver", "crew"] as const) {
    for (const scenario of ["future", "delayed"] as const) {
      it(`${subject}: ${scenario === "future" ? "returns the original clamp on a retry" : "does not turn request delay into clock skew"}`, async () => {
        const { db, shop, reef, booking } = await manifestContext();
        const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
        vi.mocked(getDb).mockResolvedValue(db);
        vi.mocked(auth).mockResolvedValue({
          user: {
            personId: actor,
            shopId: shop.id,
            shopSlug: shop.slug,
            name: "Owner",
            email: SEEDED_OWNER_EMAIL,
            roles: ["owner"],
          },
        } as DiveDaySession);
        const crewId = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew[0]?.id;
        if (!crewId) throw new Error("seeded crew missing");
        const start = nowMs();
        if (scenario === "delayed") {
          advanceClock(5 * MINUTE);
          const live = {
            shopId: shop.id,
            tripId: reef.id,
            recordedByPersonId: actor,
            checkpoint: "after_dive_1" as const,
            status: "not_boarded" as const,
          };
          const recorded =
            subject === "diver"
              ? await recordRollCall(db, { ...live, bookingId: booking.booking.id })
              : await recordCrewRollCall(db, { ...live, personId: crewId });
          expect(recorded.ok).toBe(true);
          advanceClock(MINUTE);
        }
        const event = {
          clientEventId: crypto.randomUUID(),
          snapshotId: crypto.randomUUID(),
          snapshotSavedAt: iso(start - MINUTE),
          tripId: reef.id,
          checkpoint: "after_dive_1",
          ...(subject === "diver" ? { bookingId: booking.booking.id } : { crewPersonId: crewId }),
          status: "boarded",
          occurredAt: iso(start + (scenario === "future" ? 10 * MINUTE : 0)),
        };
        // A request sent at minute one can arrive at minute six. The server must
        // not add those five minutes to the tap and erase minute five's alarm.
        const response = await POST(
          request({ includeStoredInstants: true, sentAt: iso(start + MINUTE), events: [event] }),
        );
        expect(response.status).toBe(200);
        expect((await response.json()).results[0]).toMatchObject({
          status: "applied",
          storedOccurredAt: iso(start),
        });
        if (scenario === "delayed") {
          const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
          const standing =
            subject === "diver"
              ? manifest?.divers.find((row) => row.bookingId === booking.booking.id)
              : manifest?.crew.find((row) => row.id === crewId);
          // Retain both statements for explicit reconciliation. Neither tap time
          // nor send/receive delay proves that the aboard mark saw the alarm.
          expect(standing?.rollCall).toMatchObject({ state: "not_boarded" });
          expect(standing?.rollCallContext).toMatchObject({
            conflict: true,
            orderingUnknown: true,
          });
          expect(standing?.rollCallContext?.observedEvidenceIds).toHaveLength(2);
        }
        advanceClock(2 * MINUTE);
        const retry = await POST(request({ includeStoredInstants: true, events: [event] }));
        expect((await retry.json()).results[0]).toMatchObject({
          status: "duplicate",
          storedOccurredAt: iso(start),
        });
        if (scenario === "delayed") {
          const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
          const standing =
            subject === "diver"
              ? manifest?.divers.find((row) => row.bookingId === booking.booking.id)
              : manifest?.crew.find((row) => row.id === crewId);
          expect(standing?.rollCall).toMatchObject({ state: "not_boarded" });
          expect(standing?.rollCallContext?.conflict).toBe(true);
          expect(standing?.rollCallContext?.observedEvidenceIds).toHaveLength(2);
        }
      });
    }
  }
});
