import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import {
  rollCallEventClaims,
  shops,
  unresolvedSafetyAlertEscalations,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyAlertScan,
  unresolvedSafetyScanIncidents,
} from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import {
  issueOfflineManifestSnapshot,
  readOfflineManifestRoster,
} from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

vi.mock("./review-availability", () => ({ unresolvedReviewAvailable: () => true }));
vi.mock("./delivery-worker", () => ({ dispatchUnresolvedSafetyReview: vi.fn() }));
const { dispatchUnresolvedSafetyReview } = await import("./delivery-worker");
const { scanUnresolvedSafetyAlerts } = await import("./delivery-scan");
const dispatch = vi.mocked(dispatchUnresolvedSafetyReview);
const provider = { safetySingleAttemptAbortable: true as const, send: vi.fn() };
const ctx = fileScopedShopContext();
beforeEach(() => dispatch.mockReset());

async function addObligation(sequence: number) {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("trip missing");
  const generationId = crypto.randomUUID();
  const [claim] = await db
    .insert(rollCallEventClaims)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "erased",
      retainedSafetyEvidence: {
        version: 1,
        receiptId: generationId,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        occurredAt: nowDate().toISOString(),
        meetingDay: null,
        observedEvidenceIds: null,
        retractsEventId: null,
        retractsClientEventId: null,
        reconcilesEvidence: false,
        noteRetained: false,
      },
    })
    .returning({ id: rollCallEventClaims.id });
  const [outbox] = await db
    .insert(unresolvedSafetyAlertOutbox)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      claimId: claim.id,
      generationId,
      scanSequence: sequence,
    })
    .returning({ id: unresolvedSafetyAlertOutbox.id });
  return outbox.id;
}

it("uses a finite high water and revisits a late commit below the cursor", async () => {
  const first = await addObligation(10);
  const second = await addObligation(20);
  const [trip] = await upcomingTripsWithCounts(ctx.db, ctx.shop.id);
  if (!trip) throw new Error("trip missing");
  const before = await readOfflineManifestRoster(ctx.db, ctx.shop.id, trip.id);
  if (!before) throw new Error("roster missing");
  dispatch.mockResolvedValue({ status: "no_recipients", ledger: {} });
  expect(await scanUnresolvedSafetyAlerts(ctx.db, provider, 1)).toEqual({
    status: "scanned",
    scanned: 1,
    cycleFinished: false,
  });
  expect(await issueOfflineManifestSnapshot(ctx.db, ctx.shop.id, trip.id, before)).toMatchObject({
    ok: false,
    reason: "snapshot_superseded",
  });
  expect(await getTripManifest(ctx.db, ctx.shop.id, trip.id, "after_dive_1")).toMatchObject({
    completeness: { complete: false, retainedSafetyAlertNeedsReview: true },
  });
  const late = await addObligation(5);
  const newer = await addObligation(30);
  await scanUnresolvedSafetyAlerts(ctx.db, provider, 1);
  expect(dispatch.mock.calls.map((call) => call[1])).toEqual([first, second]);
  expect(await scanUnresolvedSafetyAlerts(ctx.db, provider, 1)).toEqual({
    status: "scanned",
    scanned: 0,
    cycleFinished: true,
  });
  await scanUnresolvedSafetyAlerts(ctx.db, provider, 1);
  expect(dispatch.mock.calls.map((call) => call[1])).toEqual([first, second, late]);
  expect(dispatch.mock.calls.map((call) => call[1])).not.toContain(newer);
  const escalations = await ctx.db.select().from(unresolvedSafetyAlertEscalations);
  expect(escalations.map((row) => row.kind)).toEqual([
    "no_recipients",
    "no_recipients",
    "no_recipients",
  ]);
});

it("cannot advance or clear a lease that was taken over during dispatch", async () => {
  await addObligation(10);
  const replacement = crypto.randomUUID();
  dispatch.mockImplementationOnce(async () => {
    await ctx.db
      .update(unresolvedSafetyAlertScan)
      .set({ leaseId: replacement, leaseUntil: new Date(nowDate().getTime() + 60_000) })
      .where(eq(unresolvedSafetyAlertScan.name, "unresolved-safety"));
    return { status: "no_recipients", ledger: {} };
  });
  expect(await scanUnresolvedSafetyAlerts(ctx.db, provider, 1)).toEqual({
    status: "lost_lease",
    scanned: 0,
  });
  const [row] = await ctx.db
    .select()
    .from(unresolvedSafetyAlertScan)
    .where(eq(unresolvedSafetyAlertScan.name, "unresolved-safety"));
  expect(row).toMatchObject({ cursor: 0, leaseId: replacement });
  expect(await ctx.db.select().from(unresolvedSafetyAlertEscalations)).toEqual([]);
});

it("records a dispatch error before advancing and retains it on a later pass", async () => {
  await addObligation(10);
  dispatch.mockRejectedValueOnce(new Error("test failure"));
  expect(await scanUnresolvedSafetyAlerts(ctx.db, provider, 2)).toEqual({
    status: "scanned",
    scanned: 1,
    cycleFinished: true,
  });
  expect(
    (await ctx.db.select().from(unresolvedSafetyAlertEscalations)).map((row) => row.kind),
  ).toEqual(["dispatch_error"]);
  dispatch.mockResolvedValue({
    status: "attempted",
    delivered: 1,
    alreadyDelivered: 0,
    uncertain: 0,
    pending: 0,
    ledger: { delivered: 1 },
  });
  await scanUnresolvedSafetyAlerts(ctx.db, provider, 2);
  expect(
    (await ctx.db.select().from(unresolvedSafetyAlertEscalations)).map((row) => row.kind),
  ).toEqual(["dispatch_error"]);
});

it("records unavailable dispatch and still reaches later obligations", async () => {
  const first = await addObligation(10);
  const second = await addObligation(20);
  dispatch.mockResolvedValueOnce({ status: "unavailable" });
  dispatch.mockResolvedValueOnce({ status: "no_recipients", ledger: {} });
  expect(await scanUnresolvedSafetyAlerts(ctx.db, provider, 3)).toEqual({
    status: "scanned",
    scanned: 2,
    cycleFinished: true,
  });
  expect(dispatch.mock.calls.map((call) => call[1])).toEqual([first, second]);
  const rows = await ctx.db.select().from(unresolvedSafetyAlertEscalations);
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ outboxId: first, kind: "dispatch_error" }),
      expect.objectContaining({ outboxId: second, kind: "no_recipients" }),
    ]),
  );
});

it("records a changed generation without attaching an escalation to the wrong one", async () => {
  const id = await addObligation(10);
  dispatch.mockImplementationOnce(async () => {
    await ctx.db
      .update(unresolvedSafetyAlertOutbox)
      .set({ generationId: crypto.randomUUID() })
      .where(eq(unresolvedSafetyAlertOutbox.id, id));
    return { status: "no_recipients", ledger: {} };
  });
  expect(await scanUnresolvedSafetyAlerts(ctx.db, provider, 2)).toEqual({
    status: "scanned",
    scanned: 1,
    cycleFinished: true,
  });
  const [state] = await ctx.db
    .select()
    .from(unresolvedSafetyAlertScan)
    .where(eq(unresolvedSafetyAlertScan.name, "unresolved-safety"));
  expect(state).toMatchObject({ lastProblem: "generation_missing", lastProblemSequence: 10 });
  expect(await ctx.db.select().from(unresolvedSafetyScanIncidents)).toMatchObject([
    { outboxId: id, scanSequence: 10 },
  ]);
  expect(await ctx.db.select().from(unresolvedSafetyAlertEscalations)).toEqual([]);
});

it.each(["shopId", "tripId", "claimId"] as const)(
  "records a changed %s without attaching an escalation to the wrong scope",
  async (field) => {
    const id = await addObligation(10);
    const otherId = await addObligation(20);
    const [other] = await ctx.db
      .select()
      .from(unresolvedSafetyAlertOutbox)
      .where(eq(unresolvedSafetyAlertOutbox.id, otherId));
    const [otherShop] = await ctx.db
      .insert(shops)
      .values({
        name: "Other shop",
        slug: `other-${crypto.randomUUID()}`,
        timezone: "UTC",
      })
      .returning({ id: shops.id });
    const otherTrip = (await upcomingTripsWithCounts(ctx.db, ctx.shop.id)).find(
      (trip) => trip.id !== other.tripId,
    );
    if (!otherTrip) throw new Error("second trip missing");
    const replacement =
      field === "shopId" ? otherShop.id : field === "tripId" ? otherTrip.id : other.claimId;
    dispatch.mockImplementationOnce(async () => {
      await ctx.db
        .update(unresolvedSafetyAlertOutbox)
        .set({ [field]: replacement })
        .where(eq(unresolvedSafetyAlertOutbox.id, id));
      return { status: "no_recipients", ledger: {} };
    });
    expect(await scanUnresolvedSafetyAlerts(ctx.db, provider, 1)).toEqual({
      status: "scanned",
      scanned: 1,
      cycleFinished: false,
    });
    expect(await ctx.db.select().from(unresolvedSafetyScanIncidents)).toMatchObject([
      { outboxId: id, scanSequence: 10 },
    ]);
    expect(await ctx.db.select().from(unresolvedSafetyAlertEscalations)).toEqual([]);
  },
);
