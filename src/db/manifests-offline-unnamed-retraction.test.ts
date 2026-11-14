import { describe, expect, it, vi } from "vitest";
import { log } from "@/lib/log";
import { capturedMeeting, HOUR, twoDayCourse } from "@/test/offline-meeting-test-support";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));

/**
 * An unnamed offline undo supplies no target proof, including when a selected
 * later meeting day is declared. It cannot erase a carried missing report.
 * Retain the legacy absent-basis controls and their refusal/log assertions.
 */
describe("an unnamed offline retraction after a dive", () => {
  it("is refused on day two, and day one's missing diver stays on the manifest", async () => {
    vi.mocked(log).mockClear();
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    // Day one: the diver did not come back from dive 1.
    await recordRollCall(db, {
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    // Day two: a phone queues a bare `cleared` at the same checkpoint.
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        ...(await capturedMeeting(db, shop.id, reef.id, 1)),
        source: "offline",
        clientEventId: "eeeeeeee-3333-4333-8333-eeeeeeeeeeee",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 1 * HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(log).toHaveBeenCalledWith("manifest.offline_retraction_superseded", "warn", {
      shopId: shop.id,
      tripId: reef.id,
    });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("is refused for the crew's own roll call too", async () => {
    const { db, shop, reef, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    await recordCrewRollCall(db, {
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        ...(await capturedMeeting(db, shop.id, reef.id, 1)),
        source: "offline",
        clientEventId: "ffffffff-3333-4333-8333-ffffffffffff",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 1 * HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.find(
        (entry) => entry.id === staff.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("treats an empty retractsClientEventId as naming nothing, and refuses it", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_2" as const,
    };
    await recordRollCall(db, {
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        ...(await capturedMeeting(db, shop.id, reef.id, 1)),
        source: "offline",
        clientEventId: "12121212-5555-4555-8555-121212121212",
        retractsClientEventId: "",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 1 * HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_2"))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("is refused even when nothing stands at that checkpoint, because it names nothing", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        checkpoint: "after_dive_1",
        status: "cleared",
        ...(await capturedMeeting(db, shop.id, reef.id, 1)),
        source: "offline",
        clientEventId: "34343434-5555-4555-8555-343434343434",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 1 * HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
  });

  it("does not let a replay of the refused event slip through as a duplicate", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    await recordRollCall(db, {
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    const bare = {
      ...base,
      status: "cleared" as const,
      meetingDay: 1,
      ...(await capturedMeeting(db, shop.id, reef.id, 1)),
      source: "offline" as const,
      clientEventId: "56565656-5555-4555-8555-565656565656",
      offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
      occurredAt: new Date(now - 1 * HOUR),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(recordRollCall(db, bare)).resolves.toEqual({
        ok: false,
        reason: "retraction_superseded",
      });
    }
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("still applies the crew's own bare cleared at the dock", async () => {
    const { db, shop, reef, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure" as const,
      ...(await capturedMeeting(db, shop.id, reef.id, 1)),
      source: "offline" as const,
      offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
    };
    await recordCrewRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      clientEventId: "78787878-6666-4666-8666-787878787878",
      occurredAt: new Date(now - 90 * 60 * 1000),
    });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        clientEventId: "9a9a9a9a-6666-4666-8666-9a9a9a9a9a9a",
        occurredAt: new Date(now - 80 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "departure"))?.crew.find(
        (item) => item.id === staff.id,
      )?.rollCall,
    ).toBeUndefined();
  });

  it("still applies at the dock, where a cleared never reaches back to a missing diver", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure" as const,
      ...(await capturedMeeting(db, shop.id, reef.id, 1)),
      source: "offline" as const,
      offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
    };
    await recordRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      clientEventId: "abababab-4444-4444-8444-abababababab",
      occurredAt: new Date(now - 90 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        clientEventId: "cdcdcdcd-4444-4444-8444-cdcdcdcdcdcd",
        occurredAt: new Date(now - 80 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "departure"))?.divers.find(
        (item) => item.bookingId === booking.booking.id,
      )?.rollCall,
    ).toBeUndefined();
  });
});
