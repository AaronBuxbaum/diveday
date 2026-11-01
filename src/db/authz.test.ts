import { and, eq, isNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  canPersonAddDiver,
  canPersonCallDayBlowout,
  canPersonConfigureTrips,
  canPersonDeleteDiver,
  canPersonErasePersonalData,
  canPersonExportIncidentRecord,
  canPersonManageOrders,
  canPersonManagePaymentSettings,
  canPersonManageStaffAccounts,
  canPersonManageWaiverTemplates,
  canPersonOverrideGearRequest,
  canPersonPrintMedicalAlerts,
  canPersonReadEveryIncidentReport,
  canPersonReadMedicalAlert,
  canPersonReadMedicalAlertOnTrip,
  canPersonReadMedicalAnswers,
  canPersonReadPrivateRecapPulse,
  canPersonRefund,
  emergencyMedicalAlertStanding,
  loadActiveStaffRoles,
  loadActiveStaffRolesByPerson,
  requireActiveStaffId,
} from "./authz";
import type { AppDb } from "./client";
import { people, personRoles, shops, tripAssignments, trips, userAccounts } from "./schema";

let seq = 0;

async function makeStaff(
  db: AppDb,
  shopId: string,
  roles: Role[],
  opts: { status?: "active" | "disabled"; deleted?: boolean } = {},
): Promise<string> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({
      shopId,
      fullName: `Staff ${seq}`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `staff.${seq}@example.com`,
    hashedPassword: "x",
    status: opts.status ?? "active",
  });
  return person.id;
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("loadActiveStaffRoles", () => {
  it("returns the person's live roles for an active staff member", async () => {
    const { db, shop } = ctx;
    const person = await makeStaff(db, shop.id, ["owner", "manager"]);
    const roles = await loadActiveStaffRoles(db, shop.id, person);
    expect(roles).not.toBeNull();
    expect([...(roles ?? [])].sort()).toEqual(["manager", "owner"]);
  });

  it("returns null for a disabled account, a deleted person, or the wrong shop", async () => {
    const { db, shop } = ctx;
    const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });
    const owner = await makeStaff(db, shop.id, ["owner"]);

    expect(await loadActiveStaffRoles(db, shop.id, disabled)).toBeNull();
    expect(await loadActiveStaffRoles(db, shop.id, deleted)).toBeNull();
    expect(
      await loadActiveStaffRoles(db, "00000000-0000-0000-0000-000000000000", owner),
    ).toBeNull();
  });
});

describe("requireActiveStaffId", () => {
  it("returns an id only for live staff in the requested shop", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const diver = await makeStaff(db, shop.id, ["diver"]);
    const disabled = await makeStaff(db, shop.id, ["manager"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["captain"], { deleted: true });

    expect(await requireActiveStaffId(db, shop.id, owner)).toBe(owner);
    expect(await requireActiveStaffId(db, shop.id, diver)).toBeNull();
    expect(await requireActiveStaffId(db, shop.id, disabled)).toBeNull();
    expect(await requireActiveStaffId(db, shop.id, deleted)).toBeNull();
    expect(
      await requireActiveStaffId(db, "00000000-0000-0000-0000-000000000000", owner),
    ).toBeNull();
  });
});

/**
 * The person-scoped sibling `requireStaffSession()` calls (issue #701). The
 * one behavior that distinguishes it from `loadActiveStaffRoles` above: it
 * must not care whether the caller's own claimed shop id is right, only
 * whether the account itself is still real — a stale shop claim is a 404 for
 * `requireShopSurface` to decide, never a reason this reports "disabled".
 */
describe("loadActiveStaffRolesByPerson", () => {
  it("returns the person's live roles for an active staff member", async () => {
    const { db, shop } = ctx;
    const person = await makeStaff(db, shop.id, ["owner", "manager"]);
    const roles = await loadActiveStaffRolesByPerson(db, person);
    expect([...(roles ?? [])].sort()).toEqual(["manager", "owner"]);
  });

  it("returns null for a disabled account or a deleted person", async () => {
    const { db, shop } = ctx;
    const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });

    expect(await loadActiveStaffRolesByPerson(db, disabled)).toBeNull();
    expect(await loadActiveStaffRolesByPerson(db, deleted)).toBeNull();
  });

  it("does not care which shop id the caller supplies — there isn't one to check", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    // Same person, still active — a wrong or stale shop claim is simply not
    // this function's question.
    expect(await loadActiveStaffRolesByPerson(db, owner)).toEqual(["owner"]);
  });

  it("returns null for a person id that does not exist", async () => {
    const { db } = ctx;
    expect(
      await loadActiveStaffRolesByPerson(db, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});

describe("adding a diver from search (every staff role)", () => {
  it("admits each staff role and refuses an account with no staff role", async () => {
    const { db, shop } = ctx;
    for (const role of [
      "owner",
      "manager",
      "instructor",
      "captain",
      "divemaster",
      "crew",
    ] as const) {
      expect(await canPersonAddDiver(db, shop.id, await makeStaff(db, shop.id, [role]))).toBe(true);
    }
    expect(await canPersonAddDiver(db, shop.id, "00000000-0000-0000-0000-000000000000")).toBe(
      false,
    );
  });
});

describe("H-14 owner/manager surfaces", () => {
  it("admit an owner and a manager, refuse instructor and the daily crew", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const captain = await makeStaff(db, shop.id, ["captain"]);
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);

    for (const gate of [
      canPersonManageOrders,
      canPersonManagePaymentSettings,
      canPersonRefund,
      canPersonManageWaiverTemplates,
      canPersonDeleteDiver,
      canPersonManageStaffAccounts,
      // #1410: the private recap pulse. Its own predicate rather than the
      // reports gate it used to borrow, because the recap form promises the
      // diver this reader set by name (src/lib/authz.ts).
      canPersonReadPrivateRecapPulse,
      // Every incident report, whoever wrote it (ADR 20261012-incident-reports).
      canPersonReadEveryIncidentReport,
    ]) {
      expect(await gate(db, shop.id, owner)).toBe(true);
      expect(await gate(db, shop.id, manager)).toBe(true);
      expect(await gate(db, shop.id, instructor)).toBe(false);
      expect(await gate(db, shop.id, captain)).toBe(false);
      expect(await gate(db, shop.id, divemaster)).toBe(false);
    }
  });

  it("refuse a disabled or deleted owner immediately (closes the JWT window)", async () => {
    const { db, shop } = ctx;
    const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });

    expect(await canPersonRefund(db, shop.id, disabled)).toBe(false);
    expect(await canPersonDeleteDiver(db, shop.id, deleted)).toBe(false);
    expect(await canPersonReadEveryIncidentReport(db, shop.id, disabled)).toBe(false);
    // The strictest gate closes the same window.
    expect(await canPersonExportIncidentRecord(db, shop.id, disabled)).toBe(false);
    expect(await canPersonExportIncidentRecord(db, shop.id, deleted)).toBe(false);
  });

  /**
   * The incident export is owner-only, and it is one of only two gates in
   * src/lib/authz.ts that stops short of owner-*or*-manager. That makes manager
   * the role a future edit is most likely to wave through by pattern-matching
   * the gates around it, so the live path pins it here rather than relying on
   * the pure predicate's own test (security review 20260804).
   */
  it("admits only an owner to the incident-ready export", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const captain = await makeStaff(db, shop.id, ["captain"]);
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);
    const crew = await makeStaff(db, shop.id, ["crew"]);

    expect(await canPersonExportIncidentRecord(db, shop.id, owner)).toBe(true);
    for (const person of [manager, instructor, captain, divemaster, crew]) {
      expect(await canPersonExportIncidentRecord(db, shop.id, person)).toBe(false);
    }
    // Strictly tighter than the owner/manager gates it sits beside.
    expect(await canPersonRefund(db, shop.id, manager)).toBe(true);
  });
});

describe("medical answers on a signed record (canPersonReadMedicalAnswers)", () => {
  it("admits a live owner and manager; refuses every other staff role", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    expect(await canPersonReadMedicalAnswers(db, shop.id, owner)).toBe(true);
    expect(await canPersonReadMedicalAnswers(db, shop.id, manager)).toBe(true);
    for (const role of [
      "instructor",
      "assistant_instructor",
      "divemaster",
      "captain",
      "crew",
    ] as const) {
      const person = await makeStaff(db, shop.id, [role]);
      expect(await canPersonReadMedicalAnswers(db, shop.id, person)).toBe(false);
    }
  });

  it("refuses a disabled manager, a deleted manager, and a manager of another shop", async () => {
    const { db, shop } = ctx;
    const disabled = await makeStaff(db, shop.id, ["manager"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["manager"], { deleted: true });
    const manager = await makeStaff(db, shop.id, ["manager"]);
    expect(await canPersonReadMedicalAnswers(db, shop.id, disabled)).toBe(false);
    expect(await canPersonReadMedicalAnswers(db, shop.id, deleted)).toBe(false);
    expect(
      await canPersonReadMedicalAnswers(db, "00000000-0000-0000-0000-000000000000", manager),
    ).toBe(false);
  });
});

describe("the medical alert for the crew (canPersonReadMedicalAlertOnTrip, issue #2960)", () => {
  async function twoTrips(db: AppDb, shopId: string) {
    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shopId), isNull(trips.deletedAt)))
      .limit(2);
    const [mine, other] = rows;
    if (!mine || !other) throw new Error("expected two seeded departures");
    return { mine: mine.id, other: other.id };
  }

  it("admits the owner and a manager on any departure, crewing it or not", async () => {
    const { db, shop } = ctx;
    const { mine } = await twoTrips(db, shop.id);
    for (const role of ["owner", "manager"] as const) {
      const person = await makeStaff(db, shop.id, [role]);
      expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, person, mine)).toBe(true);
      expect(await canPersonReadMedicalAlert(db, shop.id, person)).toBe(true);
    }
  });

  it("admits other staff on the departure they crew, and on no other", async () => {
    const { db, shop } = ctx;
    const { mine, other } = await twoTrips(db, shop.id);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    for (const role of [
      "instructor",
      "assistant_instructor",
      "divemaster",
      "captain",
      "crew",
    ] as const) {
      const person = await makeStaff(db, shop.id, [role]);
      // Unassigned: the fact of an alert, never its text.
      expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, person, mine)).toBe(false);
      await db
        .insert(tripAssignments)
        .values({ tripId: mine, personId: person, assignedByPersonId: manager });
      expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, person, mine)).toBe(true);
      // Crewing one departure reads nothing on another.
      expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, person, other)).toBe(false);
      // No departure in hand (the signed record): owner and manager only.
      expect(await canPersonReadMedicalAlert(db, shop.id, person)).toBe(false);
    }
  });

  it("refuses crew who rostered themselves, or whose assignment names nobody, and admits the same person once a manager assigns them", async () => {
    const { db, shop } = ctx;
    const { mine, other } = await twoTrips(db, shop.id);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    // Self-rostered on the board: no trust in the roster they wrote themselves.
    await db
      .insert(tripAssignments)
      .values({ tripId: mine, personId: instructor, assignedByPersonId: instructor });
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, instructor, mine)).toBe(false);
    // An assignment that names nobody is not a manager's assignment either.
    await db.insert(tripAssignments).values({ tripId: other, personId: instructor });
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, instructor, other)).toBe(false);
    // Assigned by a manager: admitted.
    await db
      .update(tripAssignments)
      .set({ assignedByPersonId: manager })
      .where(and(eq(tripAssignments.tripId, mine), eq(tripAssignments.personId, instructor)));
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, instructor, mine)).toBe(true);
    // The owner and a manager are unaffected by how they got on the roster.
    await db
      .insert(tripAssignments)
      .values({ tripId: mine, personId: manager, assignedByPersonId: manager });
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, manager, mine)).toBe(true);
  });

  it("counts an assignment only when a live owner or manager of this shop made it (security review 2, M-1)", async () => {
    const { db, shop } = ctx;
    const { mine, other } = await twoTrips(db, shop.id);
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const a = await makeStaff(db, shop.id, ["instructor"]);
    const b = await makeStaff(db, shop.id, ["instructor"]);
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);
    // Two instructors roster each other, and one rosters a friendly divemaster.
    await db.insert(tripAssignments).values([
      { tripId: mine, personId: b, assignedByPersonId: a },
      { tripId: mine, personId: a, assignedByPersonId: b },
      { tripId: mine, personId: divemaster, assignedByPersonId: a },
    ]);
    for (const person of [a, b, divemaster]) {
      expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, person, mine)).toBe(false);
    }
    // A manager's assignment and the owner's assignment count.
    await db
      .update(tripAssignments)
      .set({ assignedByPersonId: manager })
      .where(and(eq(tripAssignments.tripId, mine), eq(tripAssignments.personId, b)));
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, b, mine)).toBe(true);
    await db
      .insert(tripAssignments)
      .values({ tripId: other, personId: divemaster, assignedByPersonId: owner });
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, divemaster, other)).toBe(true);
    // The manager is later demoted: what they assigned stops counting.
    await db
      .update(personRoles)
      .set({ role: "instructor" })
      .where(eq(personRoles.personId, manager));
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, b, mine)).toBe(false);
    // The owner's account is disabled, then the person removed: the same.
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, owner));
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, divemaster, other)).toBe(false);
    await db.update(userAccounts).set({ status: "active" }).where(eq(userAccounts.personId, owner));
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, divemaster, other)).toBe(true);
    await db
      .update(people)
      .set({ deletedAt: new Date("2026-06-01T00:00:00Z") })
      .where(eq(people.id, owner));
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, divemaster, other)).toBe(false);
    // Another shop's manager is nobody's manager here.
    const [elsewhere] = await db.select({ id: shops.id }).from(shops).where(ne(shops.id, shop.id));
    if (!elsewhere) throw new Error("expected a second seeded shop");
    const outsider = await makeStaff(db, elsewhere.id, ["manager"]);
    await db
      .update(tripAssignments)
      .set({ assignedByPersonId: outsider })
      .where(and(eq(tripAssignments.tripId, mine), eq(tripAssignments.personId, a)));
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, a, mine)).toBe(false);
  });

  it("refuses an assigned crew member who is disabled or deleted, and another shop's departure", async () => {
    const { db, shop } = ctx;
    const { mine } = await twoTrips(db, shop.id);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const disabled = await makeStaff(db, shop.id, ["divemaster"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["divemaster"], { deleted: true });
    const crewing = await makeStaff(db, shop.id, ["divemaster"]);
    await db.insert(tripAssignments).values([
      { tripId: mine, personId: disabled, assignedByPersonId: manager },
      { tripId: mine, personId: deleted, assignedByPersonId: manager },
      { tripId: mine, personId: crewing, assignedByPersonId: manager },
    ]);
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, disabled, mine)).toBe(false);
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, deleted, mine)).toBe(false);
    // Another shop: neither its staff nor its departures answer here.
    const [elsewhere] = await db.select({ id: shops.id }).from(shops).where(ne(shops.id, shop.id));
    if (!elsewhere) throw new Error("expected a second seeded shop");
    expect(await canPersonReadMedicalAlertOnTrip(db, elsewhere.id, crewing, mine)).toBe(false);
    const otherManager = await makeStaff(db, elsewhere.id, ["manager"]);
    expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, otherManager, mine)).toBe(false);
    const [otherTrip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, elsewhere.id))
      .limit(1);
    if (otherTrip) {
      await db
        .insert(tripAssignments)
        .values({ tripId: otherTrip.id, personId: crewing, assignedByPersonId: manager });
      expect(await canPersonReadMedicalAlertOnTrip(db, shop.id, crewing, otherTrip.id)).toBe(false);
    }
  });
});

describe("printing the medical alerts' words (canPersonPrintMedicalAlerts, issue #2990)", () => {
  it("admits the owner and a manager, and refuses crew, an instructor and another shop's staff", async () => {
    const { db, shop } = ctx;
    for (const role of ["owner", "manager"] as const) {
      expect(
        await canPersonPrintMedicalAlerts(db, shop.id, await makeStaff(db, shop.id, [role])),
      ).toBe(true);
    }
    for (const role of ["crew", "instructor", "divemaster", "captain"] as const) {
      expect(
        await canPersonPrintMedicalAlerts(db, shop.id, await makeStaff(db, shop.id, [role])),
      ).toBe(false);
    }
    const [elsewhere] = await db.select({ id: shops.id }).from(shops).where(ne(shops.id, shop.id));
    if (!elsewhere) throw new Error("expected a second seeded shop");
    const outsider = await makeStaff(db, elsewhere.id, ["owner"]);
    expect(await canPersonPrintMedicalAlerts(db, shop.id, outsider)).toBe(false);
    // A manager demoted or disabled since prints the flag only.
    const manager = await makeStaff(db, shop.id, ["manager"], { status: "disabled" });
    expect(await canPersonPrintMedicalAlerts(db, shop.id, manager)).toBe(false);
  });
});

/** Whether the emergency read is open to this staffer on this departure now. */
async function canPersonEmergencyReadMedicalAlertOnTrip(
  db: AppDb,
  shopId: string,
  personId: string,
  tripId: string,
  now?: Date,
): Promise<boolean> {
  return (await emergencyMedicalAlertStanding(db, shopId, personId, tripId, now)) === "open";
}

describe("the emergency read (emergencyMedicalAlertStanding, issue #2990)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function departureAt(db: AppDb, shopId: string, startsAt: Date) {
    const [row] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shopId), isNull(trips.deletedAt)))
      .orderBy(trips.id)
      .limit(1);
    if (!row) throw new Error("expected a seeded departure");
    await db
      .update(trips)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000) })
      .where(eq(trips.id, row.id));
    return row.id;
  }

  it("admits any active staffer of the shop on the day the departure leaves", async () => {
    const { db, shop } = ctx;
    const trip = await departureAt(db, shop.id, nowDate());
    for (const role of ["instructor", "divemaster", "crew", "captain", "owner"] as const) {
      const person = await makeStaff(db, shop.id, [role]);
      expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, person, trip)).toBe(true);
    }
  });

  it("refuses the day before and the day after", async () => {
    const { db, shop } = ctx;
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const tomorrow = await departureAt(db, shop.id, new Date(nowDate().getTime() + DAY_MS));
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, instructor, tomorrow)).toBe(
      false,
    );
    const yesterday = await departureAt(db, shop.id, new Date(nowDate().getTime() - DAY_MS));
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, instructor, yesterday)).toBe(
      false,
    );
  });

  it("reads today in the shop's zone, not in UTC", async () => {
    const { db, shop } = ctx;
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    // 13:30Z on the frozen day is 03:30 in Honolulu; 01:00Z the next UTC day
    // is still 15:00 the same Honolulu day.
    await db.update(shops).set({ timezone: "Pacific/Honolulu" }).where(eq(shops.id, shop.id));
    const now = nowDate();
    const sameLocalDay = new Date(now.getTime() + 11.5 * 60 * 60 * 1000);
    const trip = await departureAt(db, shop.id, sameLocalDay);
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, instructor, trip, now)).toBe(
      true,
    );
    // Eight hours earlier in UTC is 19:30 the evening before in Honolulu: that
    // boat was back by 20:30, so its days are over by 03:30.
    const eveningBefore = new Date(now.getTime() - 8 * 60 * 60 * 1000);
    await db
      .update(trips)
      .set({ startsAt: eveningBefore, endsAt: new Date(eveningBefore.getTime() + 60 * 60 * 1000) })
      .where(eq(trips.id, trip));
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, instructor, trip, now)).toBe(
      false,
    );
  });

  it("refuses a disabled or removed staffer, a diver, another shop's staff and another shop's departure", async () => {
    const { db, shop } = ctx;
    const trip = await departureAt(db, shop.id, nowDate());
    const disabled = await makeStaff(db, shop.id, ["divemaster"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["divemaster"], { deleted: true });
    const diver = await makeStaff(db, shop.id, ["diver"]);
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, disabled, trip)).toBe(false);
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, deleted, trip)).toBe(false);
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, diver, trip)).toBe(false);
    const [elsewhere] = await db.select({ id: shops.id }).from(shops).where(ne(shops.id, shop.id));
    if (!elsewhere) throw new Error("expected a second seeded shop");
    const outsider = await makeStaff(db, elsewhere.id, ["owner"]);
    // Their own shop's id with this departure, and this shop's id with them.
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, elsewhere.id, outsider, trip)).toBe(
      false,
    );
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, outsider, trip)).toBe(false);
    const insider = await makeStaff(db, shop.id, ["instructor"]);
    const [otherTrip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, elsewhere.id))
      .limit(1);
    if (otherTrip) {
      await db
        .update(trips)
        .set({ startsAt: nowDate(), endsAt: new Date(nowDate().getTime() + 4 * 60 * 60 * 1000) })
        .where(eq(trips.id, otherTrip.id));
      expect(
        await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, insider, otherTrip.id),
      ).toBe(false);
    }
  });
});

describe("the emergency read's window: the days of the trip (emergencyMedicalAlertStanding)", () => {
  const ZONE = "America/New_York";
  const at = (year: number, month: number, day: number, hour: number, minute = 0, zone = ZONE) =>
    wallTimeToUtc({ year, month, day, hour, minute }, zone);

  async function departureBetween(db: AppDb, shopId: string, startsAt: Date, endsAt: Date) {
    const [row] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shopId), isNull(trips.deletedAt)))
      .orderBy(trips.id)
      .limit(1);
    if (!row) throw new Error("expected a seeded departure");
    await db.update(trips).set({ startsAt, endsAt }).where(eq(trips.id, row.id));
    return row.id;
  }

  it("is open for a 23:00 departure read at 00:15 the next day", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ timezone: ZONE }).where(eq(shops.id, shop.id));
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);
    const trip = await departureBetween(db, shop.id, at(2026, 7, 21, 23), at(2026, 7, 21, 23, 45));
    const now = at(2026, 7, 22, 0, 15);
    expect(await emergencyMedicalAlertStanding(db, shop.id, divemaster, trip, now)).toBe("open");
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, divemaster, trip, now)).toBe(
      true,
    );
  });

  it("is open on day 2 of a three-day trip", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ timezone: ZONE }).where(eq(shops.id, shop.id));
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const trip = await departureBetween(db, shop.id, at(2026, 7, 21, 8), at(2026, 7, 23, 16));
    const now = at(2026, 7, 22, 10);
    expect(await emergencyMedicalAlertStanding(db, shop.id, instructor, trip, now)).toBe("open");
    expect(await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, instructor, trip, now)).toBe(
      true,
    );
  });

  it("is closed the day after endsAt, and not yet open before the start date", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ timezone: ZONE }).where(eq(shops.id, shop.id));
    const captain = await makeStaff(db, shop.id, ["captain"]);
    const trip = await departureBetween(db, shop.id, at(2026, 7, 21, 8), at(2026, 7, 21, 16));
    const dayAfter = at(2026, 7, 22, 10);
    expect(await emergencyMedicalAlertStanding(db, shop.id, captain, trip, dayAfter)).toBe(
      "closed",
    );
    expect(
      await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, captain, trip, dayAfter),
    ).toBe(false);
    const eveningBefore = at(2026, 7, 20, 21);
    expect(await emergencyMedicalAlertStanding(db, shop.id, captain, trip, eveningBefore)).toBe(
      "not_yet",
    );
    expect(
      await canPersonEmergencyReadMedicalAlertOnTrip(db, shop.id, captain, trip, eveningBefore),
    ).toBe(false);
  });

  it("reads the days in a shop zone far from UTC", async () => {
    const { db, shop } = ctx;
    // Kiritimati is UTC+14: its 2026-07-21 runs from 10:00Z on the 20th.
    const LINE_ISLANDS = "Pacific/Kiritimati";
    await db.update(shops).set({ timezone: LINE_ISLANDS }).where(eq(shops.id, shop.id));
    const crew = await makeStaff(db, shop.id, ["crew"]);
    const trip = await departureBetween(
      db,
      shop.id,
      at(2026, 7, 21, 8, 0, LINE_ISLANDS),
      at(2026, 7, 21, 12, 0, LINE_ISLANDS),
    );
    const standing = (iso: string) =>
      emergencyMedicalAlertStanding(db, shop.id, crew, trip, new Date(iso));
    expect(await standing("2026-07-20T09:59:00Z")).toBe("not_yet");
    expect(await standing("2026-07-20T10:00:00Z")).toBe("open");
    expect(await standing("2026-07-21T09:59:00Z")).toBe("open");
    expect(await standing("2026-07-21T10:00:00Z")).toBe("closed");
  });

  it("tells someone the rule never admits nothing about the window", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ timezone: ZONE }).where(eq(shops.id, shop.id));
    const disabled = await makeStaff(db, shop.id, ["divemaster"], { status: "disabled" });
    const diver = await makeStaff(db, shop.id, ["diver"]);
    const trip = await departureBetween(db, shop.id, at(2026, 7, 21, 8), at(2026, 7, 21, 16));
    for (const person of [disabled, diver]) {
      for (const now of [at(2026, 7, 20, 21), at(2026, 7, 21, 10), at(2026, 7, 22, 10)]) {
        expect(await emergencyMedicalAlertStanding(db, shop.id, person, trip, now)).toBe("refused");
      }
    }
  });
});

describe("erasure (canPersonErasePersonalData)", () => {
  it("admits only a live owner of this shop", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const disabledOwner = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
    expect(await canPersonErasePersonalData(db, shop.id, owner)).toBe(true);
    expect(await canPersonErasePersonalData(db, shop.id, manager)).toBe(false);
    expect(await canPersonErasePersonalData(db, shop.id, disabledOwner)).toBe(false);
    expect(
      await canPersonErasePersonalData(db, "00000000-0000-0000-0000-000000000000", owner),
    ).toBe(false);
  });
});

describe("H-06 gear-request override", () => {
  it("admits owner, manager, instructor, and divemaster; refuses deck crew", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);
    const captain = await makeStaff(db, shop.id, ["captain"]);
    const crew = await makeStaff(db, shop.id, ["crew"]);

    expect(await canPersonOverrideGearRequest(db, shop.id, owner)).toBe(true);
    expect(await canPersonOverrideGearRequest(db, shop.id, manager)).toBe(true);
    expect(await canPersonOverrideGearRequest(db, shop.id, instructor)).toBe(true);
    expect(await canPersonOverrideGearRequest(db, shop.id, divemaster)).toBe(true);
    expect(await canPersonOverrideGearRequest(db, shop.id, captain)).toBe(false);
    expect(await canPersonOverrideGearRequest(db, shop.id, crew)).toBe(false);
  });

  it("refuses a disabled divemaster immediately", async () => {
    const { db, shop } = ctx;
    const disabled = await makeStaff(db, shop.id, ["divemaster"], { status: "disabled" });
    expect(await canPersonOverrideGearRequest(db, shop.id, disabled)).toBe(false);
  });
});

describe("the day's weather call", () => {
  it("admits owner, manager, and captain; refuses instructor, divemaster, and crew", async () => {
    const { db, shop } = ctx;
    for (const [roles, allowed] of [
      [["owner"], true],
      [["manager"], true],
      [["captain"], true],
      [["instructor"], false],
      [["divemaster"], false],
      [["crew"], false],
    ] as const) {
      const person = await makeStaff(db, shop.id, [...roles]);
      expect(await canPersonCallDayBlowout(db, shop.id, person)).toBe(allowed);
    }
  });
});

describe("H-14 trip configuration", () => {
  it("admits owner, manager, and instructor; refuses captain, crew, and divemaster", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const captain = await makeStaff(db, shop.id, ["captain"]);
    const crew = await makeStaff(db, shop.id, ["crew"]);
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);

    expect(await canPersonConfigureTrips(db, shop.id, owner)).toBe(true);
    expect(await canPersonConfigureTrips(db, shop.id, manager)).toBe(true);
    expect(await canPersonConfigureTrips(db, shop.id, instructor)).toBe(true);
    expect(await canPersonConfigureTrips(db, shop.id, captain)).toBe(false);
    expect(await canPersonConfigureTrips(db, shop.id, crew)).toBe(false);
    expect(await canPersonConfigureTrips(db, shop.id, divemaster)).toBe(false);
  });
});
