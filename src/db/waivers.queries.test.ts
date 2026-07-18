// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import {
  ensureWaiverForBooking,
  getActiveWaiverTemplate,
  getWaiverByToken,
  recordPhysicianClearance,
  signWaiverByToken,
  tripRoster,
} from "./queries";
import { seedDemo } from "./seed";

async function seeded() {
  const db = await createTestDb();
  await seedDemo(db);
  return db;
}

describe("waiver queries (in-memory PGlite)", () => {
  it("resolves a waiver by its link token with the diver and trip", async () => {
    const db = await seeded();
    const template = await getActiveWaiverTemplate(db, (await firstShopId(db)) ?? "");
    expect(template?.requiresMedical).toBe(true);

    // Grab a seeded pending waiver via the roster of the reef trip.
    const reefTripId = await reefTrip(db);
    const roster = await tripRoster(db, reefTripId);
    const pending = roster.find((r) => r.waiver?.status === "pending");
    if (!pending?.waiver) throw new Error("expected a pending seeded waiver");

    const view = await getWaiverByToken(db, pending.waiver.token);
    expect(view?.diverName).toBe(pending.diverName);
    expect(view?.tripTitle).toContain("Two-Tank Reef");
    expect(view?.template.body.length).toBeGreaterThan(0);
  });

  it("signs a pending waiver clean and blocks a flagged one", async () => {
    const db = await seeded();
    const reefTripId = await reefTrip(db);
    const roster = await tripRoster(db, reefTripId);
    const pendings = roster.filter((r) => r.waiver?.status === "pending");
    const [clean, flagged] = pendings;
    if (!clean?.waiver || !flagged?.waiver) throw new Error("need two pending waivers");

    const signed = await signWaiverByToken(db, clean.waiver.token, {
      signedName: "Priya Sharma",
      medicalFlagged: false,
      medicalNotes: null,
    });
    expect(signed?.status).toBe("signed");
    expect(signed?.signedAt).toBeInstanceOf(Date);

    const blocked = await signWaiverByToken(db, flagged.waiver.token, {
      signedName: "Tom Okafor",
      medicalFlagged: true,
      medicalNotes: "heart",
    });
    expect(blocked?.status).toBe("physician_required");
  });

  it("refuses to sign the same waiver twice", async () => {
    const db = await seeded();
    const roster = await tripRoster(db, await reefTrip(db));
    const pending = roster.find((r) => r.waiver?.status === "pending");
    if (!pending?.waiver) throw new Error("need a pending waiver");

    const first = await signWaiverByToken(db, pending.waiver.token, {
      signedName: "Diver One",
      medicalFlagged: false,
      medicalNotes: null,
    });
    expect(first).not.toBeNull();

    const second = await signWaiverByToken(db, pending.waiver.token, {
      signedName: "Impostor",
      medicalFlagged: false,
      medicalNotes: null,
    });
    expect(second).toBeNull();
  });

  it("physician clearance lifts a block, and only from a blocked state", async () => {
    const db = await seeded();
    const roster = await tripRoster(db, await reefTrip(db));
    const blocked = roster.find((r) => r.waiver?.status === "physician_required");
    if (!blocked?.waiver) throw new Error("expected a seeded blocked waiver");

    const cleared = await recordPhysicianClearance(db, blocked.waiver.id);
    expect(cleared?.status).toBe("signed");
    expect(cleared?.physicianClearedAt).toBeInstanceOf(Date);

    // A second clearance is a no-op (already signed, not blocked).
    const again = await recordPhysicianClearance(db, blocked.waiver.id);
    expect(again).toBeNull();
  });

  it("creates one waiver per booking, idempotently", async () => {
    const db = await seeded();
    const shopId = (await firstShopId(db)) ?? "";
    const template = await getActiveWaiverTemplate(db, shopId);
    if (!template) throw new Error("no template");
    // A booking on a trip with no seeded waivers (night dive).
    const roster = await tripRoster(db, await reefTrip(db));
    const bookingId = roster[0].booking.id;

    const a = await ensureWaiverForBooking(db, { shopId, bookingId, templateId: template.id });
    const b = await ensureWaiverForBooking(db, { shopId, bookingId, templateId: template.id });
    expect(a.id).toBe(b.id);
  });
});

async function firstShopId(db: Awaited<ReturnType<typeof createTestDb>>): Promise<string | null> {
  const rows = await db.query.shops.findMany({ limit: 1 });
  return rows[0]?.id ?? null;
}

async function reefTrip(db: Awaited<ReturnType<typeof createTestDb>>): Promise<string> {
  const rows = await db.query.trips.findMany();
  const reef = rows.find((t) => t.title.includes("Molasses"));
  if (!reef) throw new Error("reef trip missing from seed");
  return reef.id;
}
