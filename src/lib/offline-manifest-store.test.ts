// @vitest-environment jsdom
// Browser-side store: exercises navigator.onLine, IndexedDB, and fetch paths.
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { TEST_FROZEN_CLOCK } from "@/test/frozen-clock";
import {
  acknowledgeDiscardedOfflineRecords,
  appendOfflineRollCall,
  listOfflineManifests,
  loadOfflineManifest,
  OFFLINE_MANIFEST_PENDING_GRACE_MS,
  purgeOfflineManifestsExceptShop,
  readDiscardedOfflineRecords,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";
import {
  OFFLINE_MANIFEST_MAX_RETENTION_MS,
  type OfflineManifestPayload,
} from "./offline-manifests";
import { RETENTION_DAYS } from "./retention";

const FROZEN_MS = Date.parse(TEST_FROZEN_CLOCK);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An expiry in the past but still inside the pending-event grace window — the
 * state the preserved-because-pending exception exists for. A day inside the
 * ceiling rather than a hair, so the assertion is about the rule and not about
 * millisecond rounding.
 */
const EXPIRED_WITHIN_GRACE = new Date(
  FROZEN_MS - OFFLINE_MANIFEST_PENDING_GRACE_MS + DAY_MS,
).toISOString();

/** The same record a day past the ceiling: the reprieve is over, pending or not. */
const EXPIRED_PAST_GRACE = new Date(
  FROZEN_MS - OFFLINE_MANIFEST_PENDING_GRACE_MS - DAY_MS,
).toISOString();

const payload: OfflineManifestPayload = {
  shop: { slug: "blue-mantis", name: "Blue Mantis Divers", timezone: "America/New_York" },
  manifests: [
    {
      trip: {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Two-Tank Reef — Molasses & French",
        startsAt: "2026-08-01T13:00:00.000Z",
        endsAt: "2026-08-01T16:30:00.000Z",
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [
        {
          // A copy saved since H-46 carries the crew member's person id, which
          // is what makes the crew half of the head count recordable here.
          id: "33333333-3333-3333-3333-333333333333",
          fullName: "Sal Moretti",
          roles: ["captain"],
        },
      ],
      divers: [
        {
          bookingId: "22222222-2222-2222-2222-222222222222",
          fullName: "Nora Quinn",
          email: null,
          emergencyContactName: "Sam Quinn",
          emergencyContactPhone: "+1-305-555-0100",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
          rollCall: undefined,
        },
      ],
      summary: {
        totalDivers: 1,
        ready: 1,
        blocked: 0,
        boarded: 0,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 1,
        unaccountedFor: 1,
      },
    },
  ],
};

// A second, distinct trip departing earlier than `payload`'s, so the list's
// soonest-departure-first ordering (ADR 20260726-shopwide-offline-manifest-priming)
// has something real to sort against.
const earlierPayload: OfflineManifestPayload = {
  shop: payload.shop,
  manifests: [
    {
      ...payload.manifests[0],
      trip: {
        ...payload.manifests[0].trip,
        id: "33333333-3333-3333-3333-333333333333",
        title: "Wreck & Reef — Duane",
        startsAt: "2026-07-30T09:00:00.000Z",
        endsAt: "2026-07-30T12:30:00.000Z",
      },
    },
  ],
};

// A trip saved by a *different* shop on the same device/browser — the
// cross-tenant scenario purgeOfflineManifestsExceptShop exists to close (see
// ADR 20260726-shopwide-offline-manifest-priming).
const otherShopPayload: OfflineManifestPayload = {
  shop: { slug: "reef-runners", name: "Reef Runners", timezone: "America/New_York" },
  manifests: [
    {
      ...payload.manifests[0],
      trip: {
        ...payload.manifests[0].trip,
        id: "44444444-4444-4444-4444-444444444444",
        title: "Morning Two-Tank",
        startsAt: "2026-08-02T13:00:00.000Z",
        endsAt: "2026-08-02T16:30:00.000Z",
      },
    },
  ],
};

// A trip with a diver who is not ready at departure (an uncleared medical,
// say), saved with both a "departure" and an "after_dive_1" checkpoint — for
// the dive-domain-expert regression below (task 72, invariant 2).
const blockedDiverPayload: OfflineManifestPayload = {
  shop: payload.shop,
  manifests: [
    {
      ...payload.manifests[0],
      checkpoint: "departure",
      divers: [
        { ...payload.manifests[0].divers[0], readiness: { status: "blocked", blockers: [] } },
      ],
    },
    {
      ...payload.manifests[0],
      checkpoint: "after_dive_1",
      divers: [
        { ...payload.manifests[0].divers[0], readiness: { status: "blocked", blockers: [] } },
      ],
    },
  ],
};

/** Backdates a stored record's plaintext expiry without touching its ciphertext. */
function patchStoredExpiresAt(tripId: string, expiresAt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onsuccess = () => {
      const db = request.result;
      const getRequest = db
        .transaction("manifests", "readonly")
        .objectStore("manifests")
        .get(tripId);
      getRequest.onsuccess = () => {
        const record = getRequest.result;
        record.expiresAt = expiresAt;
        const writeTransaction = db.transaction("manifests", "readwrite");
        writeTransaction.objectStore("manifests").put(record);
        writeTransaction.oncomplete = () => {
          db.close();
          resolve();
        };
        writeTransaction.onerror = () => reject(writeTransaction.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/** The raw stored row, to tell "deleted" apart from "not returned to a reader". */
function rawStoredRecord(tripId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onsuccess = () => {
      const db = request.result;
      const getRequest = db
        .transaction("manifests", "readonly")
        .objectStore("manifests")
        .get(tripId);
      getRequest.onsuccess = () => {
        db.close();
        resolve(getRequest.result);
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Each device keeps one IndexedDB record per trip; wipe it between tests so a
// prior test's synced/rejected events can't bleed into the next one's.
afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

describe("saveOfflineManifest", () => {
  it("still saves a fresh snapshot when the existing device record is corrupt or undecryptable", async () => {
    // Simulate storage corruption (a bad key, a version/AAD mismatch, flipped
    // bytes) by writing a record straight into IndexedDB that this module's
    // own AES-GCM key can never decrypt. There's no delete button on this
    // surface anymore, so a save must self-heal past this rather than
    // permanently failing every future save on the device.
    const tripId = payload.manifests[0].trip.id;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys");
        if (!db.objectStoreNames.contains("manifests")) {
          db.createObjectStore("manifests", { keyPath: "tripId" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("manifests", "readwrite");
        transaction.objectStore("manifests").put({
          tripId,
          expiresAt: new Date(nowMs() + 60 * 60 * 1000).toISOString(),
          iv: new Uint8Array(12).buffer,
          ciphertext: new Uint8Array([1, 2, 3, 4]).buffer,
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const envelope = await saveOfflineManifest(payload);
    expect(envelope.events).toEqual([]);

    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded?.snapshot.snapshotId).toBe(envelope.snapshot.snapshotId);
  });
});

describe("loadOfflineManifest", () => {
  it("keeps an expired record alive if it still has an unsynced pending event", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    const envelope = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    expect(envelope.events[0].syncStatus).toBe("pending");

    // Simulate the retention window having passed while that change never
    // made it to the server — there's no delete button, so this must not
    // silently destroy the only record of it.
    // In the past relative to the frozen test clock (src/test/frozen-clock.ts)
    // that `nowDate()` reads in tests — real wall-clock time wouldn't reliably
    // be "in the past" relative to that frozen instant — and still inside the
    // pending-event grace window, which is what this exception is bounded by.
    await patchStoredExpiresAt(tripId, EXPIRED_WITHIN_GRACE);

    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.events).toHaveLength(1);
    expect(reloaded?.events[0].syncStatus).toBe("pending");
  });

  // Security review, 2026-08-06 (F3). The exception above had no end to it: a
  // pending event can only reconcile under the shop that recorded it, so a
  // record whose shop never signs into this tablet again was kept forever —
  // and `/offline-manifest` has no auth gate, so "forever" means anyone
  // holding the tablet can read that shop's diver names, emergency contacts
  // and readiness/medical blockers with no session at all. Past the ceiling
  // the record goes, whatever is queued on it.
  it("discards an expired record past the pending-event ceiling even though the event never synced", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    await patchStoredExpiresAt(tripId, EXPIRED_PAST_GRACE);

    expect(await loadOfflineManifest(tripId)).toBeNull();
    // Gone from storage, not merely withheld from this one reader — the
    // finding is that the ciphertext stays decryptable on the device.
    expect(await rawStoredRecord(tripId)).toBeUndefined();
  });

  // Deleting unsynced evidence of who came back from a dive is its own harm,
  // so the loss is written down where a screen can report it — the delete
  // frequently happens with no page open at all (the service worker's push
  // refresh, the staff layout's auto-save), which is why this is durable
  // rather than a return value nobody would read.
  it("writes down what it discarded, and nothing about the divers on it", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: "left with the shore boat",
    });
    await patchStoredExpiresAt(tripId, EXPIRED_PAST_GRACE);
    await loadOfflineManifest(tripId);

    const discarded = await readDiscardedOfflineRecords();
    expect(discarded).toEqual([
      {
        tripId,
        tripTitle: payload.manifests[0].trip.title,
        shopName: payload.shop.name,
        pendingEvents: 1,
        discardedAt: new Date(FROZEN_MS).toISOString(),
      },
    ]);

    // Adversarial: the notice must not quietly re-retain the roster the
    // discard exists to remove. Nothing personal survives the delete — not the
    // diver, not their emergency contact, not the booking id that points at
    // them, not the note a captain typed.
    const serialized = JSON.stringify(discarded);
    for (const leak of [
      payload.manifests[0].divers[0].fullName,
      payload.manifests[0].divers[0].emergencyContactName,
      payload.manifests[0].divers[0].emergencyContactPhone ?? "",
      payload.manifests[0].divers[0].bookingId,
      "left with the shore boat",
    ]) {
      expect(serialized).not.toContain(leak);
    }

    // It survives a reload — a captain who never opened the shell that day
    // still hears about it — until someone acknowledges it.
    expect(await readDiscardedOfflineRecords()).toHaveLength(1);
    await acknowledgeDiscardedOfflineRecords();
    expect(await readDiscardedOfflineRecords()).toEqual([]);
  });

  it("says nothing when an expired record with no pending events is cleaned up", async () => {
    // The ordinary retention delete is not a loss: there was no unsynced
    // evidence on it. A notice for every routine expiry would be noise on the
    // one surface that must stay quiet enough to be read.
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    await patchStoredExpiresAt(tripId, EXPIRED_PAST_GRACE);

    expect(await loadOfflineManifest(tripId)).toBeNull();
    expect(await readDiscardedOfflineRecords()).toEqual([]);
  });

  it("deletes an expired record once it has no unsynced pending events", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    // Well before the frozen test clock (src/test/frozen-clock.ts) that
    // `nowDate()` reads in tests — using real wall-clock time here wouldn't
    // reliably be "in the past" relative to that frozen instant.
    await patchStoredExpiresAt(tripId, "2020-01-01T00:00:00.000Z");

    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded).toBeNull();
  });
});

describe("listOfflineManifests", () => {
  it("returns every saved trip, soonest departure first", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(earlierPayload);

    const list = await listOfflineManifests();
    expect(list.map((envelope) => envelope.snapshot.manifests[0].trip.id)).toEqual([
      earlierPayload.manifests[0].trip.id,
      payload.manifests[0].trip.id,
    ]);
  });

  it("omits an expired record with no unsynced pending event", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(earlierPayload);
    await patchStoredExpiresAt(payload.manifests[0].trip.id, "2020-01-01T00:00:00.000Z");

    const list = await listOfflineManifests();
    expect(list.map((envelope) => envelope.snapshot.manifests[0].trip.id)).toEqual([
      earlierPayload.manifests[0].trip.id,
    ]);
  });

  it("keeps an expired record with a still-pending event, same as loadOfflineManifest", async () => {
    await saveOfflineManifest(payload);
    const tripId = payload.manifests[0].trip.id;
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    await patchStoredExpiresAt(tripId, EXPIRED_WITHIN_GRACE);

    const list = await listOfflineManifests();
    expect(list.map((envelope) => envelope.snapshot.manifests[0].trip.id)).toEqual([tripId]);
  });

  // The ceiling is enforced in loadOfflineManifest, which this reads every
  // record through, so *opening the shell* is enough to clear a past-ceiling
  // record: no session, no network, no purge pass, nobody signing in. That is
  // what makes the bound hold on the tablet the original shop never touches
  // again (security review, 2026-08-06, F3).
  it("drops a past-ceiling pending record on an ordinary read, with no session involved", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(earlierPayload);
    const tripId = payload.manifests[0].trip.id;
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    await patchStoredExpiresAt(tripId, EXPIRED_PAST_GRACE);

    const list = await listOfflineManifests();
    expect(list.map((envelope) => envelope.snapshot.manifests[0].trip.id)).toEqual([
      earlierPayload.manifests[0].trip.id,
    ]);
    expect(await rawStoredRecord(tripId)).toBeUndefined();
    expect(await readDiscardedOfflineRecords()).toHaveLength(1);
  });

  it("returns an empty list when nothing has been saved on this device", async () => {
    expect(await listOfflineManifests()).toEqual([]);
  });

  it("sorts a retained past trip behind every upcoming one, even though its startsAt is earlier", async () => {
    // Ended two days ago — well within its 7-day post-trip retention window
    // (still a legitimately retained record, not expired), but a plain
    // ascending startsAt sort would still put it first, exactly the ordering
    // bug this test guards against. It should trail every trip still ahead
    // of it, not lead the list.
    const twoDaysAgo = FROZEN_MS - 2 * 24 * 60 * 60 * 1000;
    const pastPayload: OfflineManifestPayload = {
      ...payload,
      manifests: [
        {
          ...payload.manifests[0],
          trip: {
            ...payload.manifests[0].trip,
            id: "55555555-5555-5555-5555-555555555555",
            title: "Last Week's Reef Trip",
            startsAt: new Date(twoDaysAgo - 3 * 60 * 60 * 1000).toISOString(),
            endsAt: new Date(twoDaysAgo).toISOString(),
          },
        },
      ],
    };
    await saveOfflineManifest(payload);
    await saveOfflineManifest(earlierPayload);
    await saveOfflineManifest(pastPayload);

    const list = await listOfflineManifests();
    expect(list.map((envelope) => envelope.snapshot.manifests[0].trip.id)).toEqual([
      earlierPayload.manifests[0].trip.id,
      payload.manifests[0].trip.id,
      pastPayload.manifests[0].trip.id,
    ]);
  });
});

describe("purgeOfflineManifestsExceptShop", () => {
  it("deletes every device record whose shop doesn't match, keeping the caller's own shop intact", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(otherShopPayload);

    await purgeOfflineManifestsExceptShop(payload.shop.slug);

    const remaining = await listOfflineManifests();
    expect(remaining.map((envelope) => envelope.snapshot.shop.slug)).toEqual([payload.shop.slug]);
    expect(await loadOfflineManifest(otherShopPayload.manifests[0].trip.id)).toBeNull();
    expect(await loadOfflineManifest(payload.manifests[0].trip.id)).not.toBeNull();
  });

  it("is a no-op when every saved record already belongs to the given shop", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(earlierPayload);

    await purgeOfflineManifestsExceptShop(payload.shop.slug);

    const remaining = await listOfflineManifests();
    expect(remaining).toHaveLength(2);
  });

  // Security review, 2026-08-06. This is the delete pass, and a slug that
  // matches *no* saved record is a slug that matches every one of them — so
  // `""`/`undefined`/`null` wiped the device, the signed-in shop's own copies
  // included, on a boat, with no page open to say so. The guard lives here
  // rather than at the two call sites because a caller-side check only ever
  // protects the callers that remember to write one, and the two that existed
  // already disagreed: the offline shell validated the slug, while the shop
  // layout's auto-save reached this through a cast of an unparsed
  // `response.json()`.
  it.each([
    ["an empty string", ""],
    ["undefined", undefined],
    ["null", null],
  ])("refuses %s and deletes nothing, this device's own shop included", async (_label, slug) => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(otherShopPayload);

    // The cast is the whole point: this is exactly what a caller reading an
    // unvalidated body hands over, and `pnpm typecheck` cannot see it.
    await purgeOfflineManifestsExceptShop(slug as unknown as string);

    const remaining = await listOfflineManifests();
    expect(remaining.map((envelope) => envelope.snapshot.shop.slug).sort()).toEqual(
      [payload.shop.slug, otherShopPayload.shop.slug].sort(),
    );
  });

  it("preserves another shop's record if it still holds an unsynced roll-call event", async () => {
    // That event can't reconcile under this (different) shop's session — the
    // server would look it up against the wrong tenant — so deleting it here
    // would destroy the only copy of that evidence for good instead of
    // leaving it to resolve the next time the original shop's own session
    // runs a purge pass.
    await saveOfflineManifest(payload);
    await saveOfflineManifest(otherShopPayload);
    await appendOfflineRollCall(otherShopPayload.manifests[0].trip.id, {
      bookingId: otherShopPayload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "boarded",
      note: null,
    });

    await purgeOfflineManifestsExceptShop(payload.shop.slug);

    const preserved = await loadOfflineManifest(otherShopPayload.manifests[0].trip.id);
    expect(preserved).not.toBeNull();
    expect(preserved?.events[0].syncStatus).toBe("pending");
  });

  // The other half of that reprieve (security review, 2026-08-06, F3). The
  // preserved record above belongs to a shop that may never sign into this
  // tablet again, and `/offline-manifest` has no auth gate — so "preserved
  // until they come back" was, for that device, "readable by whoever is
  // holding it, forever". Past the ceiling it goes even here, and the purge
  // inherits that from loadOfflineManifest rather than repeating the rule.
  it("deletes another shop's past-ceiling record despite its unsynced event, and says what it lost", async () => {
    const foreignTripId = otherShopPayload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    await saveOfflineManifest(otherShopPayload);
    await appendOfflineRollCall(foreignTripId, {
      bookingId: otherShopPayload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "boarded",
      note: null,
    });
    await patchStoredExpiresAt(foreignTripId, EXPIRED_PAST_GRACE);

    await purgeOfflineManifestsExceptShop(payload.shop.slug);

    expect(await rawStoredRecord(foreignTripId)).toBeUndefined();
    expect(await readDiscardedOfflineRecords()).toMatchObject([
      { tripId: foreignTripId, shopName: otherShopPayload.shop.name, pendingEvents: 1 },
    ]);
    // This shop's own copy is untouched: the ceiling is about age, not tenancy.
    expect(await loadOfflineManifest(payload.manifests[0].trip.id)).not.toBeNull();
  });
});

/**
 * The window itself, asserted rather than commented — the same discipline
 * `retentionWindowsOutlastStripeRetries` (src/lib/retention.ts) applies to the
 * Stripe webhook window. An unbounded exception to a retention rule was the
 * finding; a bound nobody checks is the same finding one edit later.
 */
describe("OFFLINE_MANIFEST_PENDING_GRACE_MS", () => {
  it("outlasts the longest a copy is meant to live, so real trips get their chance to sync", async () => {
    expect(OFFLINE_MANIFEST_PENDING_GRACE_MS).toBeGreaterThanOrEqual(
      OFFLINE_MANIFEST_MAX_RETENTION_MS,
    );
  });

  it("stays inside the shortest window the retention table gives a device-held artifact", async () => {
    // `push_subscriptions` (30 days) is the closest analogue in
    // `src/lib/retention.ts`: a device credential, useful only while its trip
    // is near, "pure blast radius" afterwards. A dock copy holds emergency
    // contacts and medical blockers on a shared tablet, so its grace period
    // has no business being more generous than that.
    expect(OFFLINE_MANIFEST_PENDING_GRACE_MS).toBeLessThanOrEqual(
      RETENTION_DAYS.push_subscriptions * DAY_MS,
    );
  });
});

describe("appendOfflineRollCall", () => {
  // H-46. The crew half goes through the same door as the diver half — same
  // lock, same expiry stop rule, same store — and differs only in which
  // subject field the event carries.
  it("queues a crew result under its person id, with no booking id anywhere on it", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);

    const envelope = await appendOfflineRollCall(tripId, {
      crewPersonId: payload.manifests[0].crew[0].id,
      checkpoint: "departure",
      status: "boarded",
      note: null,
    });

    expect(envelope.events).toHaveLength(1);
    expect(envelope.events[0]).toMatchObject({
      crewPersonId: "33333333-3333-3333-3333-333333333333",
      status: "boarded",
      syncStatus: "pending",
    });
    expect(envelope.events[0].bookingId).toBeUndefined();
    // And it survives the encrypt/decrypt round trip, which is the only form
    // the sync route will ever see it in.
    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded?.events[0].crewPersonId).toBe("33333333-3333-3333-3333-333333333333");
  });

  // An event nobody can attribute is worse than no event: it persists, it
  // syncs, and it is a claim about the one thing this surface exists to
  // record. `offlineRollCallSubject` answers null for both shapes and this
  // refuses rather than writing one.
  it("refuses an event that names neither subject, or both", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);

    await expect(
      appendOfflineRollCall(tripId, { checkpoint: "departure", status: "boarded", note: null }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    await expect(
      appendOfflineRollCall(tripId, {
        bookingId: payload.manifests[0].divers[0].bookingId,
        crewPersonId: payload.manifests[0].crew[0].id,
        checkpoint: "departure",
        status: "boarded",
        note: null,
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });

    expect((await loadOfflineManifest(tripId))?.events).toEqual([]);
  });

  // Invariant I2, at the store rather than at the screen: a copy saved before
  // crew ids rode along has no subject to record against, so the crew member
  // stays uncounted and the checkpoint stays open. Fail closed, and never the
  // other way — a checkpoint that reads finished while somebody is still down.
  it("refuses a crew member on a copy saved before crew ids, in both directions", async () => {
    const olderCopy: OfflineManifestPayload = {
      ...payload,
      manifests: [
        {
          ...payload.manifests[0],
          crew: [{ fullName: "Sal Moretti", roles: ["captain"] }],
        },
      ],
    };
    const tripId = olderCopy.manifests[0].trip.id;
    await saveOfflineManifest(olderCopy);

    for (const status of ["boarded", "not_boarded"] as const) {
      await expect(
        appendOfflineRollCall(tripId, {
          crewPersonId: "33333333-3333-3333-3333-333333333333",
          checkpoint: "departure",
          status,
          note: null,
        }),
      ).rejects.toMatchObject({ code: "not_allowed" });
    }
    expect((await loadOfflineManifest(tripId))?.events).toEqual([]);
  });

  it("refuses to record a new roll call against a snapshot kept alive past its expiry", async () => {
    // A record preserved past retention (because it still has an unsynced
    // event) is not a boarding source — the H-05 stop rule treats expired the
    // same as missing, even though loadOfflineManifest keeps serving it so
    // the pending evidence can still reconcile.
    //
    // Patching the stored record's plaintext expiresAt (as the loadOfflineManifest
    // tests above do) wouldn't reach this: appendOfflineRollCall checks the
    // *embedded* snapshot.expiresAt, a separate copy inside the encrypted
    // envelope. Record the first event against a normal, unexpired snapshot,
    // then re-save (carrying that event forward, as saveOfflineManifest
    // always does) against a trip that ended eight days ago — one day past the
    // 7-day post-trip window, so the new snapshot's expiresAt is genuinely in
    // the past, exactly as real wall-clock expiry would leave it, and still
    // comfortably inside the pending-event grace window (past *that* the
    // record is deleted outright and the refusal below would be "unavailable"
    // rather than "expired" — see the case after this one).
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    const longOverTrip: OfflineManifestPayload = {
      ...payload,
      manifests: [
        {
          ...payload.manifests[0],
          trip: {
            ...payload.manifests[0].trip,
            endsAt: new Date(FROZEN_MS - 8 * DAY_MS).toISOString(),
          },
        },
      ],
    };
    await saveOfflineManifest(longOverTrip);

    await expect(
      appendOfflineRollCall(tripId, {
        bookingId: payload.manifests[0].divers[0].bookingId,
        checkpoint: "departure",
        status: "boarded",
        note: null,
      }),
    ).rejects.toMatchObject({ code: "expired" });

    // The earlier pending event survives untouched — refusing a new one
    // doesn't discard evidence already recorded.
    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded?.events).toHaveLength(1);
  });

  // Past the ceiling the record is not "expired", it is gone — so the refusal
  // a captain's tap produces changes too. `OfflineManifestView` is what turns
  // that into something readable: it repaints instead of leaving a roster on
  // screen whose buttons all raise this (security review, 2026-08-06, F5).
  it("refuses with unavailable, not expired, once the ceiling has discarded the record", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    await patchStoredExpiresAt(tripId, EXPIRED_PAST_GRACE);

    await expect(
      appendOfflineRollCall(tripId, {
        bookingId: payload.manifests[0].divers[0].bookingId,
        checkpoint: "departure",
        status: "not_boarded",
        note: null,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  // Dive-domain-expert review (docs/product/archive/ux-personas-20260730-findings.md,
  // persona 10 Sal, task 72, invariant 2): readiness gates boarding at
  // departure only. OfflineManifestView renders a live "Board" button after
  // any numbered dive regardless of the saved readiness snapshot
  // (`ready || !isDeparture`) — this is the store-level guarantee that
  // actually recording that tap succeeds as a pure headcount, rather than
  // silently rejecting an action the UI implied would work.
  it("refuses to board a not-ready diver at departure but allows it after a numbered dive", async () => {
    const tripId = blockedDiverPayload.manifests[0].trip.id;
    const bookingId = blockedDiverPayload.manifests[0].divers[0].bookingId;
    await saveOfflineManifest(blockedDiverPayload);

    await expect(
      appendOfflineRollCall(tripId, {
        bookingId,
        checkpoint: "departure",
        status: "boarded",
        note: null,
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });

    // Same diver, same unresolved readiness — a pure headcount after dive 1
    // must succeed, matching what the "Board" button implies is possible.
    const envelope = await appendOfflineRollCall(tripId, {
      bookingId,
      checkpoint: "after_dive_1",
      status: "boarded",
      note: null,
    });
    const event = envelope.events.find((entry) => entry.checkpoint === "after_dive_1");
    expect(event?.status).toBe("boarded");
    expect(event?.syncStatus).toBe("pending");

    // "not_boarded" is always allowed regardless of checkpoint or readiness.
    const notBoarded = await appendOfflineRollCall(tripId, {
      bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    expect(
      notBoarded.events.find(
        (entry) => entry.checkpoint === "departure" && entry.status === "not_boarded",
      ),
    ).toBeDefined();
  });
});

describe("syncOfflineManifest", () => {
  it("marks a pending event applied once the server accepts it", async () => {
    await saveOfflineManifest(payload);
    const envelope = await appendOfflineRollCall(payload.manifests[0].trip.id, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    const pendingEvent = envelope.events[0];
    expect(pendingEvent.syncStatus).toBe("pending");

    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        const body = (await request.json()) as { events: Array<{ clientEventId: string }> };
        expect(body.events).toHaveLength(1);
        expect(body.events[0].clientEventId).toBe(pendingEvent.clientEventId);
        return HttpResponse.json({
          results: [{ clientEventId: pendingEvent.clientEventId, status: "applied" }],
        });
      }),
    );

    const synced = await syncOfflineManifest(payload.manifests[0].trip.id);
    expect(synced?.events[0].syncStatus).toBe("applied");

    const reloaded = await loadOfflineManifest(payload.manifests[0].trip.id);
    expect(reloaded?.events[0].syncStatus).toBe("applied");
  });

  it("marks a rejected event with the server's reason instead of silently dropping it", async () => {
    await saveOfflineManifest(payload);
    const envelope = await appendOfflineRollCall(payload.manifests[0].trip.id, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "boarded",
      note: null,
    });
    const pendingEvent = envelope.events[0];

    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json({
          results: [
            {
              clientEventId: pendingEvent.clientEventId,
              status: "rejected",
              reason: "stale_readiness",
            },
          ],
        }),
      ),
    );

    const synced = await syncOfflineManifest(payload.manifests[0].trip.id);
    expect(synced?.events[0].syncStatus).toBe("rejected");
    expect(synced?.events[0].rejectionReason).toBe("stale_readiness");
  });

  it("throws instead of silently discarding pending events when the server errors", async () => {
    await saveOfflineManifest(payload);
    await appendOfflineRollCall(payload.manifests[0].trip.id, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });

    server.use(
      http.post("/api/offline-manifests/sync", () => new HttpResponse(null, { status: 500 })),
    );

    await expect(syncOfflineManifest(payload.manifests[0].trip.id)).rejects.toMatchObject({
      code: "sync_unreachable",
    });

    const reloaded = await loadOfflineManifest(payload.manifests[0].trip.id);
    expect(reloaded?.events[0].syncStatus).toBe("pending");
  });
});
