import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate, nowMs } from "@/lib/clock";
import { ACTION_KIND_META, type TodayAction } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { createGearItem, recordGearService, reserveGearUnit, returnGearReservation } from "./gear";
import { saveRentalFit } from "./rental-fit";
import {
  boats as boatsTable,
  bookings as bookingsTable,
  shops as shopsTable,
  trips as tripsTable,
  workOrders as workOrdersTable,
} from "./schema";
import { createStaffCredential } from "./staff-credentials";
import { getTodayWork } from "./today";
import { pushEquipmentRows } from "./today-equipment-rows";
import { rowsContext, rowsNaming } from "./today-rows-test-fixtures";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { addCustomerGearItem, createWorkOrder, setWorkOrderStatus } from "./work-orders";

const emptyWave = {
  credentialRows: [],
  overdueGear: [],
  dueBackGear: [],
  gearServiceDueRows: [],
  fitAdjustedReturns: [],
  boatSafety: { departures: [], errands: [] },
  workOrdersNeedingAttention: [],
};

function rows(wave: Record<string, unknown>): TodayAction[] {
  const actions: TodayAction[] = [];
  pushEquipmentRows(actions, rowsContext({ ...emptyWave, ...wave }));
  return actions;
}

describe("pushEquipmentRows", () => {
  it("adds nothing for a shop with no fleet and no credential due", () => {
    expect(rows({})).toEqual([]);
  });

  it("groups late gear across people and opens the rentals list", () => {
    const overdueGear = [
      {
        personId: "p1",
        personName: "Rosa Diaz",
        label: "BCD 1",
        reservedUntil: "2026-07-01",
        checkedOutAt: nowDate(),
        tripTitle: null,
      },
      {
        personId: "p1",
        personName: "Rosa Diaz",
        label: "Tank 1",
        reservedUntil: "2026-07-01",
        checkedOutAt: nowDate(),
        tripTitle: null,
      },
      {
        personId: "p2",
        personName: "Sam Lee",
        label: "BCD 2",
        reservedUntil: "2026-07-02",
        checkedOutAt: null,
        tripTitle: null,
      },
    ];
    const actions = rows({ overdueGear });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "gear_overdue",
      subject: "3 late items",
      href: "/shop/blue-mantis/gear?view=rentals",
    });
    expect(actions[0]?.detail).toContain("2 people");
  });

  it("folds one staffer's lapsing credentials into one row, the earliest date leading", () => {
    const person = { id: "p1", fullName: "Rosa Diaz" };
    const actions = rows({
      credentialRows: [
        { person, credential: { name: "First aid", renewsAt: "2026-08-10" } },
        { person, credential: { name: "Insurance", renewsAt: "2026-07-30" } },
        { person, credential: { name: "Captain's licence", renewsAt: "2027-07-30" } },
      ],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "staff_credential_due",
      staffPersonId: "p1",
      subject: "Rosa Diaz",
      href: "/shop/blue-mantis/settings/team#credentials",
    });
    expect(actions[0]?.dueAt?.toISOString().slice(0, 10)).toBe("2026-07-30");
  });

  it("marks a credential overdue from its own local day, not UTC's", () => {
    const [row] = rows({
      credentialRows: [
        {
          person: { id: "p2", fullName: "Sam Lee" },
          credential: { name: "First aid", renewsAt: "2026-07-20" },
        },
      ],
    });
    expect(row?.urgency).toBe("now");
  });
});

/** One database for the file, one transaction per test (`fileScopedShopContext`, src/test/db.ts). */
const ctx = fileScopedShopContext();

/** A setup reservation: a hand pick whose staffer already said "Assign anyway". */
const SETUP_PICK = { proposed: false, assignAnyway: true } as const;

describe("rental fits on the queue, read through getTodayWork", () => {
  it("flags divers whose rental sizes are missing, and clears it once every size is on file", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    if (roster.length === 0) throw new Error("demo bookings missing");

    // Each diver's own row names their sizes job (UX delight sheet 2026-10-22,
    // item 4); the row's door is pinned in `today-departure-rows.test.ts`.
    const sizeRows = (work: Awaited<ReturnType<typeof getTodayWork>>) => [
      ...rowsNaming(work.actions, reef.id, "rental size"),
      ...rowsNaming(work.actions, reef.id, "kit"),
    ];
    const flagged = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(sizeRows(flagged).length).toBeGreaterThan(0);

    const rents = {
      rentsBcd: true,
      rentsRegulator: true,
      rentsWetsuit: true,
      rentsMask: false,
      rentsFins: true,
      rentsWeights: true,
      rentsDiveComputer: false,
      rentsGopro: false,
      rentsDrysuit: false,
      rentsHood: false,
      rentsGloves: false,
      rentsTorch: false,
      rentsSmb: false,
    };

    // A BCD size and nothing else: this is what the old rule called a fit, and
    // the packer would still have had no wetsuit, boot, fin or weight number
    // to load from. The row must stay.
    for (const entry of roster) {
      await saveRentalFit(db, {
        shopId: shop.id,
        personId: entry.person.id,
        ...rents,
        bcdSize: "M",
      });
    }
    const stillPartial = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(rowsNaming(stillPartial.actions, reef.id, "rental size").length).toBeGreaterThan(0);

    for (const entry of roster) {
      await saveRentalFit(db, {
        shopId: shop.id,
        personId: entry.person.id,
        ...rents,
        bcdSize: "M",
        wetsuitSize: "3 mm / M",
        bootSize: "9",
        finSize: "9",
        weightPreference: "12 lbs",
      });
    }

    const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(sizeRows(cleared)).toEqual([]);
  });
});

describe("gear register rows (ADR 20260815-minimal-gear-register)", () => {
  async function anySeededBooking(
    db: ReturnType<typeof fileScopedShopContext>["db"],
    shopId: string,
  ) {
    const [booking] = await db
      .select({ id: bookingsTable.id, personId: bookingsTable.personId })
      .from(bookingsTable)
      .where(and(eq(bookingsTable.shopId, shopId), eq(bookingsTable.status, "booked")))
      .limit(1);
    if (!booking) throw new Error("seeded booking missing");
    return booking;
  }

  it("the seeded fleet alone puts nothing on the queue — its clocks and windows are all ahead", async () => {
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.actions.filter((action) => action.kind.startsWith("gear_"))).toEqual([]);
  });

  it("chases a unit that never came home, and lets a return clear the row", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const item = await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #90" });
    if (!item.ok) throw new Error("item refused");
    const booking = await anySeededBooking(db, shop.id);
    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: item.item.id,
      bookingId: booking.id,
      reservedFrom: shiftCalendarDate(today, -4),
      reservedUntil: shiftCalendarDate(today, -2),
      screen: SETUP_PICK,
    });
    if (!reserved.ok) throw new Error("reserve refused");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `gear-overdue:${booking.personId}`);
    expect(row).toMatchObject({
      kind: "gear_overdue",
      urgency: "now",
      href: `/shop/${shop.slug}/gear?view=rentals`,
    });
    expect(row?.detail).toContain("BCD #90");
    expect(row?.dueAt?.getTime()).toBeLessThanOrEqual(nowMs());

    await returnGearReservation(db, {
      shopId: shop.id,
      reservationId: reserved.reservation.id,
    });
    const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(cleared.actions.some((action) => action.id === `gear-overdue:${booking.personId}`)).toBe(
      false,
    );
  });

  it("folds one diver's overdue units into one row, a sentence per chase and per day", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const booking = await anySeededBooking(db, shop.id);
    const reserve = async (label: string, until: string) => {
      // Tanks: a diver may hold several, where a second BCD is refused.
      const item = await createGearItem(db, { shopId: shop.id, kind: "tank", label });
      if (!item.ok) throw new Error("item refused");
      const reserved = await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: item.item.id,
        bookingId: booking.id,
        reservedFrom: shiftCalendarDate(today, -6),
        reservedUntil: until,
        screen: SETUP_PICK,
      });
      if (!reserved.ok) throw new Error("reserve refused");
    };
    await reserve("BCD #91", shiftCalendarDate(today, -2));
    await reserve("BCD #92", shiftCalendarDate(today, -2));
    await reserve("BCD #93", shiftCalendarDate(today, -1));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const rows = work.actions.filter(
      (action) => action.kind === "gear_overdue" && action.detail.includes("BCD #9"),
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.id).toBe(`gear-overdue:${booking.personId}`);
    // Never collected, so the "reserved until" sentence; the two units that
    // share a day share it, and the third day keeps a sentence of its own.
    expect(row?.detail).toMatch(
      /^BCD #91 and BCD #92 were reserved until .+ and never picked up\. BCD #93 was reserved until .+ and never picked up\.$/,
    );
  });

  it("lists a unit due back today, dated to the end of the shop's own day", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const item = await createGearItem(db, { shopId: shop.id, kind: "wetsuit", label: "5mm #90" });
    if (!item.ok) throw new Error("item refused");
    const booking = await anySeededBooking(db, shop.id);
    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: item.item.id,
      bookingId: booking.id,
      reservedFrom: today,
      reservedUntil: today,
      screen: SETUP_PICK,
    });
    if (!reserved.ok) throw new Error("reserve refused");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const rows = work.actions.filter((action) => action.kind === "gear_due_back");
    // One row for every return today, naming people and never the units,
    // and opening the Rentals list (Aaron, 2026-10-09).
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ id: "gear-due-back", detail: "Gear due back today." });
    expect(row?.subject).not.toBe("");
    expect(row?.detail).not.toContain("5mm #90");
    expect(row?.href).toBe(`/shop/${shop.slug}/gear?view=rentals`);
    // Due by tonight, not overdue at breakfast: the deadline is the end of
    // the shop-local day and still ahead of now.
    expect(row?.dueAt?.getTime()).toBeGreaterThan(nowMs());
    expect(row?.dueAt?.getTime()).toBeLessThanOrEqual(nowMs() + 24 * 60 * 60 * 1000);
  });

  it("surfaces this week's bench clocks — an expired one as today's work, a distant one not at all", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const lapsed = await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-90" });
    const nextWeek = await createGearItem(db, {
      shopId: shop.id,
      kind: "tank",
      label: "AL80-91",
    });
    const distant = await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-92" });
    if (!lapsed.ok || !nextWeek.ok || !distant.ok) throw new Error("item refused");
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: lapsed.item.id,
      kind: "visual_inspection",
      servicedOn: shiftCalendarDate(today, -400),
      nextDueOn: shiftCalendarDate(today, -35),
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: nextWeek.item.id,
      kind: "visual_inspection",
      servicedOn: shiftCalendarDate(today, -362),
      nextDueOn: shiftCalendarDate(today, 3),
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: distant.item.id,
      kind: "visual_inspection",
      servicedOn: shiftCalendarDate(today, -60),
      nextDueOn: shiftCalendarDate(today, 305),
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const lapsedRow = work.actions.find((action) => action.id === `gear-service:${lapsed.item.id}`);
    expect(lapsedRow).toMatchObject({
      kind: "gear_service_due",
      urgency: "now",
      subject: "AL80-90",
      href: `/shop/${shop.slug}/gear/${lapsed.item.id}`,
    });
    expect(work.actions.some((action) => action.id === `gear-service:${nextWeek.item.id}`)).toBe(
      true,
    );
    expect(work.actions.some((action) => action.id === `gear-service:${distant.item.id}`)).toBe(
      false,
    );
  });

  it("puts expired kit ashore and lapsed boat papers on one owner row each, never twice", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const hull = await createBoat(db, shop.id, "Papers Hull", 12, null, {
      certifiedPassengers: 12,
      certifiedTotalPersons: null,
      coiExpiresOn: null,
      inspectionDueOn: null,
      registrationExpiresOn: null,
      insuranceExpiresOn: shiftCalendarDate(today, -2),
    });
    // Aboard a hull with no departure today: the owner's errand, not a boat row.
    const aed = await createGearItem(db, {
      shopId: shop.id,
      kind: "aed",
      label: "AED Papers Hull",
      aboardBoatId: hull.id,
    });
    if (!aed.ok) throw new Error("item refused");
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: aed.item.id,
      kind: "aed_pads",
      servicedOn: shiftCalendarDate(today, -700),
      nextDueOn: shiftCalendarDate(today, -3),
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.actions.find((a) => a.id === `boat-safety:kit:${aed.item.id}`)).toMatchObject({
      kind: "boat_safety_expired",
      urgency: "now",
      subject: "AED Papers Hull",
      detail: "AED Papers Hull: pads expired 3 days ago",
      href: `/shop/${shop.slug}/gear/${aed.item.id}`,
    });
    // A lapsed paper is danger ink, named by its date (H-136), and gates nothing.
    const lapsed = work.actions.find((a) => a.id === `boat-safety:boat:${hull.id}`);
    expect(lapsed).toMatchObject({
      kind: "boat_papers_lapsed",
      urgency: "now",
      subject: "Papers Hull",
      detail: `Hull insurance ended ${formatCalendarDate(shiftCalendarDate(today, -2), "en-US")}`,
      href: `/shop/${shop.slug}/boats`,
    });
    expect(lapsed && ACTION_KIND_META[lapsed.kind].tone).toBe("danger");
    // Safety kit never rides the register's bench-clock row: one dead AED,
    // one row.
    expect(work.actions.some((a) => a.id === `gear-service:${aed.item.id}`)).toBe(false);
  });

  it("raises a paper inside its window as a quiet owner errand before it lapses", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const hull = await createBoat(db, shop.id, "Inspection Hull", 12, null, {
      certifiedPassengers: null,
      certifiedTotalPersons: null,
      coiExpiresOn: null,
      // 75 days out: inside the inspection's 90-day window.
      inspectionDueOn: shiftCalendarDate(today, 75),
      registrationExpiresOn: null,
      insuranceExpiresOn: null,
    });
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.actions.find((a) => a.id === `boat-safety:boat:${hull.id}`)).toMatchObject({
      kind: "boat_papers_due",
      urgency: "later",
      detail: "Next safety inspection due in 75 days",
      href: `/shop/${shop.slug}/boats`,
    });
  });

  it("raises today's departure's missing AED and lapsed flares as one row on that departure", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const [reef] = await db
      .select({ id: tripsTable.id, boatId: tripsTable.boatId, startsAt: tripsTable.startsAt })
      .from(tripsTable)
      .where(
        and(
          eq(tripsTable.shopId, shop.id),
          eq(tripsTable.title, "Two-Tank Reef — Molasses & French"),
          isNull(tripsTable.deletedAt),
        ),
      )
      .orderBy(tripsTable.startsAt)
      .limit(1);
    if (!reef?.boatId) throw new Error("the seeded reef trip sails on no boat");
    const [hull] = await db
      .select({ name: boatsTable.name })
      .from(boatsTable)
      .where(eq(boatsTable.id, reef.boatId));
    // The shop keeps an AED — on the shelf, not aboard this hull.
    const shelf = await createGearItem(db, { shopId: shop.id, kind: "aed", label: "AED shelf" });
    if (!shelf.ok) throw new Error("item refused");
    const flares = await createGearItem(db, {
      shopId: shop.id,
      kind: "flares",
      label: "Flares reef",
      aboardBoatId: reef.boatId,
    });
    if (!flares.ok) throw new Error("item refused");
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: flares.item.id,
      kind: "expiry",
      servicedOn: shiftCalendarDate(today, -900),
      nextDueOn: shiftCalendarDate(today, -3),
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.actions.find((a) => a.id === `boat-safety-kit:${reef.id}`)).toMatchObject({
      kind: "boat_safety_kit",
      subject: hull?.name,
      departure: { tripId: reef.id },
      detail: "No AED aboard · Flares reef: expired 3 days ago",
      href: `/shop/${shop.slug}/trips/${reef.id}/manifest`,
    });
    // Said once: not again as the owner's errand, nor as a bench clock.
    expect(work.actions.some((a) => a.id === `boat-safety:kit:${flares.item.id}`)).toBe(false);
    expect(work.actions.some((a) => a.id === `gear-service:${flares.item.id}`)).toBe(false);
  });

  it("is tenant-safe: another shop's queue never sees this fleet", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const item = await createGearItem(db, {
      shopId: shop.id,
      kind: "regulator",
      label: "Reg #90",
    });
    if (!item.ok) throw new Error("item refused");
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: item.item.id,
      kind: "service",
      servicedOn: shiftCalendarDate(today, -370),
      nextDueOn: shiftCalendarDate(today, -5),
    });

    // Gear servicing switched off on the Features page: no bench row, no ticket lost.
    await db.update(shopsTable).set({ workOrdersEnabled: false }).where(eq(shopsTable.id, shop.id));
    const off = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(off.actions.filter((action) => action.kind.startsWith("work_order_"))).toEqual([]);
    await db.update(shopsTable).set({ workOrdersEnabled: true }).where(eq(shopsTable.id, shop.id));

    const otherWork = await getTodayWork(
      db,
      "00000000-0000-4000-8000-000000000000",
      "other-shop",
      shop.timezone,
    );
    expect(otherWork.actions.filter((action) => action.kind.startsWith("gear_"))).toEqual([]);
  });

  it("asks about the bench: a ticket past its promise, and one ready a week and not collected", async () => {
    const { db, shop } = ctx;
    const t = staffTranslator("en-US");
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const booking = await anySeededBooking(db, shop.id);
    const added = await addCustomerGearItem(db, {
      shopId: shop.id,
      personId: booking.personId,
      kind: "regulator",
      brandModel: "Apeks XTX200",
      serviceDueOn: "",
    });
    const second = await addCustomerGearItem(db, {
      shopId: shop.id,
      personId: booking.personId,
      kind: "bcd",
      brandModel: "",
      serviceDueOn: "",
    });
    if (!added.ok || !second.ok) throw new Error("piece refused");
    const late = await createWorkOrder(db, {
      shopId: shop.id,
      personId: booking.personId,
      customerGearItemIds: [added.item.id],
      reportedProblem: "Free-flows at depth",
      promisedOn: shiftCalendarDate(today, -2),
    });
    const ready = await createWorkOrder(db, {
      shopId: shop.id,
      personId: booking.personId,
      customerGearItemIds: [second.item.id],
      reportedProblem: "Inflator sticks",
    });
    if (!late.ok || !ready.ok) throw new Error("ticket refused");
    const moved = await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ready.workOrder.id,
      status: "ready",
    });
    if (!moved.ok) throw new Error("move refused");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const lateRow = work.actions.find(
      (action) => action.id === `work-order-late:${late.workOrder.id}`,
    );
    expect(lateRow).toMatchObject({
      kind: "work_order_late",
      urgency: "now",
      href: `/shop/${shop.slug}/gear/work-orders/${late.workOrder.id}`,
      actionLabel: "Open ticket",
    });
    expect(lateRow?.detail).toBe(
      t("benchFollowUp.today.pastPromise", {
        date: formatCalendarDate(shiftCalendarDate(today, -2), "en-US"),
      }),
    );
    // Ready today: the customer has a week before anybody chases them.
    expect(work.actions.some((action) => action.kind === "work_order_uncollected")).toBe(false);

    // A week on the shelf is a row.
    await db
      .update(workOrdersTable)
      .set({ readyAt: new Date(nowMs() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(workOrdersTable.id, ready.workOrder.id));
    const weekOn = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      weekOn.actions.find((action) => action.id === `work-order-uncollected:${ready.workOrder.id}`),
    ).toMatchObject({ kind: "work_order_uncollected", urgency: "later" });

    const otherWork = await getTodayWork(
      db,
      "00000000-0000-4000-8000-000000000000",
      "other-shop",
      shop.timezone,
    );
    expect(otherWork.actions.filter((action) => action.kind.startsWith("work_order_"))).toEqual([]);
  });

  // Gear servicing off (the Features page) is about divers' own gear: a late
  // ticket on the shop's own rental unit is fleet safety and stays, opening
  // the unit on the register because the bench pages are gone.
  it("keeps a fleet unit's late ticket while gear servicing is off, and drops a customer's", async () => {
    const { db, shop } = ctx;
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const booking = await anySeededBooking(db, shop.id);
    const piece = await addCustomerGearItem(db, {
      shopId: shop.id,
      personId: booking.personId,
      kind: "regulator",
      brandModel: "",
      serviceDueOn: "",
    });
    const unit = await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #91" });
    if (!piece.ok || !unit.ok) throw new Error("subject refused");
    const customer = await createWorkOrder(db, {
      shopId: shop.id,
      personId: booking.personId,
      customerGearItemIds: [piece.item.id],
      reportedProblem: "Free-flows",
      promisedOn: shiftCalendarDate(today, -2),
    });
    const fleet = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Second stage leaks",
      promisedOn: shiftCalendarDate(today, -2),
    });
    if (!customer.ok || !fleet.ok) throw new Error("ticket refused");

    await db.update(shopsTable).set({ workOrdersEnabled: false }).where(eq(shopsTable.id, shop.id));
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.actions.some((a) => a.id === `work-order-late:${customer.workOrder.id}`)).toBe(
      false,
    );
    expect(
      work.actions.find((a) => a.id === `work-order-late:${fleet.workOrder.id}`),
    ).toMatchObject({ kind: "work_order_late", href: `/shop/${shop.slug}/gear/${unit.item.id}` });
  });
});

describe("staff credentials on Today (one row per staffer)", () => {
  const ctx = fileScopedShopContext();

  it("folds a staffer's lapsing credentials into one row, each with its own date", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    for (const [kind, name, renewsAt] of [
      ["first_aid_cpr", "First aid", shiftCalendarDate(today, -3)],
      ["liability_insurance", "Insurance", shiftCalendarDate(today, 10)],
    ] as const) {
      const made = await createStaffCredential(db, {
        shopId: shop.id,
        personId: staff.person.id,
        kind,
        name,
        renewsAt,
      });
      if (!made) throw new Error("credential refused");
    }

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const rows = work.actions.filter(
      (action) =>
        action.kind === "staff_credential_due" && action.subject === staff.person.fullName,
    );
    expect(rows).toHaveLength(1);
    // Any lapsed credential makes the whole row today's work.
    expect(rows[0]).toMatchObject({ id: `staff-credential:${staff.person.id}`, urgency: "now" });
    expect(rows[0]?.detail).toMatch(/^First aid expired .+\. Insurance renews .+\.$/);
  });
});
