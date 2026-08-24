import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { PRE_DEPARTURE_CHECK_RETRACTION_SUPERSEDED } from "@/lib/pre-departure-check";
import { seededShopContext } from "@/test/db";
import {
  createChecklistItem,
  deleteChecklistItem,
  latestPreDepartureChecksForTrip,
  listChecklistItems,
  listChecklistItemsForTrip,
  recordPreDepartureCheck,
  reorderChecklistItems,
} from "./pre-departure-check";
import { listStaff, upcomingTripsWithCounts } from "./trips";

async function checklistContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((entry) => entry.roles.includes("owner"));
  if (!owner) throw new Error("demo owner missing");
  const nonManager = staff.find(
    (entry) => !entry.roles.some((r) => r === "owner" || r === "manager"),
  );
  if (!nonManager) throw new Error("demo non-manager staff missing");
  return { db, shop, reef, owner: owner.person, nonManager: nonManager.person };
}

describe("pre-departure checklist items (in-memory PGlite)", () => {
  it("adds an item, one past the current tail, and lists it in reading order", async () => {
    // The demo shop ships its own seeded lines (seedPreDepartureChecklist) —
    // this asserts the new pair lands after them, not that the list starts
    // empty.
    const { db, shop, owner } = await checklistContext();
    const before = await listChecklistItems(db, shop.id);
    const first = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Test: emergency oxygen aboard",
    });
    expect(first.ok).toBe(true);
    const second = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Test: life jackets counted",
    });
    expect(second.ok).toBe(true);

    const items = await listChecklistItems(db, shop.id);
    expect(items.map((item) => item.label)).toEqual([
      ...before.map((item) => item.label),
      "Test: emergency oxygen aboard",
      "Test: life jackets counted",
    ]);
  });

  it("refuses a non-owner/manager from adding an item", async () => {
    const { db, shop, nonManager } = await checklistContext();
    const before = await listChecklistItems(db, shop.id);
    const outcome = await createChecklistItem(db, {
      shopId: shop.id,
      personId: nonManager.id,
      label: "Test: emergency oxygen aboard",
    });
    expect(outcome).toEqual({ ok: false, reason: "not_authorized" });
    expect(await listChecklistItems(db, shop.id)).toEqual(before);
  });

  it("refuses a duplicate label, live items only", async () => {
    const { db, shop, owner } = await checklistContext();
    await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Fire extinguisher",
    });
    const duplicate = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Fire extinguisher",
    });
    expect(duplicate).toEqual({ ok: false, reason: "duplicate_label" });
  });

  it("reorders the shop's own list", async () => {
    // A real reorder rewrites the *whole* order, the way moveChecklistItemAction
    // (settings/safety-checklist/actions.ts) does — reading the current list and
    // writing the whole id sequence back, not just the two rows that moved.
    const { db, shop, owner } = await checklistContext();
    const a = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Test: A",
    });
    const b = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Test: B",
    });
    if (!a.ok || !b.ok) throw new Error("setup: expected both items to be created");
    const before = await listChecklistItems(db, shop.id);
    // Swap the last two entries (the pair just created, appended at the tail).
    const swapped = [...before];
    [swapped[swapped.length - 2], swapped[swapped.length - 1]] = [
      swapped[swapped.length - 1],
      swapped[swapped.length - 2],
    ];

    const outcome = await reorderChecklistItems(db, {
      shopId: shop.id,
      personId: owner.id,
      orderedIds: swapped.map((item) => item.id),
    });
    expect(outcome).toEqual({ ok: true });
    expect((await listChecklistItems(db, shop.id)).map((item) => item.label)).toEqual([
      ...before.slice(0, -2).map((item) => item.label),
      "Test: B",
      "Test: A",
    ]);
  });

  it("soft-deletes an item, which drops it from the live list but keeps its history readable", async () => {
    const { db, shop, reef, owner } = await checklistContext();
    const before = await listChecklistItems(db, shop.id);
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Test: fire extinguisher",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");
    const recorded = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "checked",
    });
    expect(recorded.ok).toBe(true);

    const deleted = await deleteChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      itemId: created.id,
    });
    expect(deleted).toEqual({ ok: true });
    expect(await listChecklistItems(db, shop.id)).toEqual(before);

    // The append-only history is untouched — the departure log still reads it.
    const latest = await latestPreDepartureChecksForTrip(db, shop.id, reef.id);
    expect(latest.get(created.id)?.state).toBe("checked");
  });

  it("listChecklistItemsForTrip keeps a deleted item on the trip it was checked for, and only that trip", async () => {
    // Found in dive-domain-expert review: the departure log used to read
    // listChecklistItems (live only), so deleting an item after a departure
    // silently dropped that item's row — and its recorded check — from a
    // past incident document. This is the guard.
    const { db, shop, owner } = await checklistContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    const night = trips.find((trip) => trip.title.startsWith("Night Dive"));
    if (!reef || !night) throw new Error("demo reef/night trips missing");

    const before = await listChecklistItems(db, shop.id);
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Test: liferaft checked",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");
    const recorded = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "checked",
    });
    expect(recorded.ok).toBe(true);
    await deleteChecklistItem(db, { shopId: shop.id, personId: owner.id, itemId: created.id });

    // Live list: gone, as before.
    expect(await listChecklistItems(db, shop.id)).toEqual(before);
    // The reef trip's own log still names it — the whole point of the fix.
    expect(
      (await listChecklistItemsForTrip(db, shop.id, reef.id)).map((item) => item.label),
    ).toContain("Test: liferaft checked");
    // A trip that never had an event against it never gets a deleted item
    // resurrected onto its log.
    expect(
      (await listChecklistItemsForTrip(db, shop.id, night.id)).map((item) => item.label),
    ).not.toContain("Test: liferaft checked");
  });
});

describe("recordPreDepartureCheck (in-memory PGlite)", () => {
  it("records a live check, and a re-tap clears it", async () => {
    const { db, shop, reef, owner } = await checklistContext();
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Emergency oxygen aboard",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");

    const checked = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "checked",
    });
    expect(checked.ok).toBe(true);
    expect(
      (await latestPreDepartureChecksForTrip(db, shop.id, reef.id)).get(created.id)?.state,
    ).toBe("checked");

    const cleared = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "cleared",
    });
    expect(cleared.ok).toBe(true);
    expect((await latestPreDepartureChecksForTrip(db, shop.id, reef.id)).has(created.id)).toBe(
      false,
    );
  });

  it("refuses a check against an item that doesn't exist on this shop", async () => {
    const { db, shop, reef, owner } = await checklistContext();
    const outcome = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: "00000000-0000-0000-0000-000000000000",
      recordedByPersonId: owner.id,
      status: "checked",
    });
    expect(outcome).toEqual({ ok: false, reason: "item_unavailable" });
  });

  it("refuses a check from someone who isn't active staff of this shop", async () => {
    const { db, shop, reef, owner } = await checklistContext();
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Emergency oxygen aboard",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");
    const outcome = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: "00000000-0000-0000-0000-000000000000",
      status: "checked",
    });
    expect(outcome).toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("dedupes an offline replay on clientEventId", async () => {
    const { db, shop, reef, owner } = await checklistContext();
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Emergency oxygen aboard",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");
    const clientEventId = "11111111-1111-1111-1111-111111111111";
    const now = nowDate();
    const input = {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "checked" as const,
      source: "offline" as const,
      clientEventId,
      offlineSnapshotSavedAt: now,
      occurredAt: now,
    };
    const first = await recordPreDepartureCheck(db, input);
    expect(first.ok).toBe(true);
    expect(first.ok && first.duplicate).toBeFalsy();
    const replay = await recordPreDepartureCheck(db, input);
    expect(replay.ok).toBe(true);
    expect(replay.ok && replay.duplicate).toBe(true);
  });

  it("refuses an offline event whose claimed occurredAt is in the future relative to the server", async () => {
    const { db, shop, reef, owner } = await checklistContext();
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Emergency oxygen aboard",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");
    // A device clock running fast enough to land outside the tolerance this
    // check allows — the same bound `recordRollCall`'s offline branch applies.
    const farFuture = new Date(nowDate().getTime() + 60 * 60 * 1000);
    const outcome = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "checked",
      source: "offline",
      clientEventId: "22222222-2222-2222-2222-222222222222",
      offlineSnapshotSavedAt: farFuture,
      occurredAt: farFuture,
    });
    expect(outcome).toEqual({ ok: false, reason: "snapshot_invalid" });
  });

  it("accepts an offline event queued against a snapshot saved up to 14 days ago", async () => {
    // The whole point of the offline design: a captain may hold a saved copy
    // for the entire retention window and still record against it, as long as
    // the event itself isn't claiming a time outside the skew tolerance.
    const { db, shop, reef, owner } = await checklistContext();
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Emergency oxygen aboard",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");
    const now = nowDate();
    const outcome = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "checked",
      source: "offline",
      clientEventId: "55555555-5555-5555-5555-555555555555",
      offlineSnapshotSavedAt: new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000),
      occurredAt: now,
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses a retraction whose named target is no longer the newest standing", async () => {
    const { db, shop, reef, owner } = await checklistContext();
    const created = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner.id,
      label: "Emergency oxygen aboard",
    });
    if (!created.ok) throw new Error("setup: expected item to be created");
    const now = nowDate();
    // A live check stands first — the offline retraction below names a
    // different (fabricated) event id, so it is not the newest standing.
    const live = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "checked",
    });
    expect(live.ok).toBe(true);

    const outcome = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: created.id,
      recordedByPersonId: owner.id,
      status: "cleared",
      source: "offline",
      clientEventId: "33333333-3333-3333-3333-333333333333",
      retractsClientEventId: "44444444-4444-4444-4444-444444444444",
      offlineSnapshotSavedAt: now,
      occurredAt: now,
    });
    expect(outcome).toEqual({
      ok: false,
      reason: PRE_DEPARTURE_CHECK_RETRACTION_SUPERSEDED,
    });
    // The live check still stands — a refused retraction leaves it in place.
    expect(
      (await latestPreDepartureChecksForTrip(db, shop.id, reef.id)).get(created.id)?.state,
    ).toBe("checked");
  });
});
