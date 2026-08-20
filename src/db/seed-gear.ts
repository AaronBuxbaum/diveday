// i18n-exempt-file: seeded demo-fleet tags and bench notes — the shop's own
// data (what a staffer wrote on a strip of tape), never app UI copy.
import {
  calendarDateInTimezone,
  shiftCalendarDate,
  shiftCalendarDateMonths,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { GearItemKind } from "@/lib/gear";
import { tripReservationWindow } from "@/lib/gear";
import type { DbExecutor } from "./client";
import {
  type bookings,
  gearItems,
  gearReservations,
  gearServiceEvents,
  type trips,
} from "./schema";

/**
 * The rental fleet on the wall: a demo-sized slice of the tagged units a Key
 * Largo shop owns (a real one runs several times this many cylinders), most
 * freshly serviced, one pulled to the bench, one tank with a visual
 * inspection coming due — the ordinary texture of a fleet, not a shop on its
 * worst day (trouble states are seeded per test through
 * `/api/test/seed-trouble-states`, never here). A few units are reserved
 * against the upcoming wreck trip so the register and that departure's prep
 * page have a live assignment to show. Dates are relative to the (frozen in
 * e2e) clock so every render is pixel-stable.
 */
export async function seedGear(
  db: DbExecutor,
  shopId: string,
  ctx: {
    timezone: string;
    tripRows: (typeof trips.$inferSelect)[];
    bookingRows: (typeof bookings.$inferSelect)[];
  },
): Promise<void> {
  const today = calendarDateInTimezone(nowDate(), ctx.timezone);
  const months = (count: number) => shiftCalendarDateMonths(today, count);

  const fleet: Array<{
    kind: GearItemKind;
    label: string;
    size?: string;
    serialNumber?: string;
    brandModel?: string;
    status?: "needs_service";
    serviceNote?: string;
  }> = [
    {
      kind: "bcd",
      label: "BCD #1",
      size: "XS",
      brandModel: "Cressi Start",
      serialNumber: "CS-2201",
    },
    {
      kind: "bcd",
      label: "BCD #2",
      size: "S",
      brandModel: "Cressi Start",
      serialNumber: "CS-2202",
    },
    {
      kind: "bcd",
      label: "BCD #3",
      size: "M",
      brandModel: "Cressi Start",
      serialNumber: "CS-2203",
    },
    {
      kind: "bcd",
      label: "BCD #4",
      size: "M",
      brandModel: "ScubaPro Level",
      serialNumber: "SP-1187",
    },
    {
      kind: "bcd",
      label: "BCD #5",
      size: "L",
      brandModel: "ScubaPro Level",
      serialNumber: "SP-1188",
    },
    {
      kind: "bcd",
      label: "BCD #6",
      size: "XL",
      brandModel: "ScubaPro Level",
      serialNumber: "SP-1189",
    },
    { kind: "regulator", label: "Reg #1", brandModel: "Aqualung Core", serialNumber: "AL-88410" },
    { kind: "regulator", label: "Reg #2", brandModel: "Aqualung Core", serialNumber: "AL-88411" },
    { kind: "regulator", label: "Reg #3", brandModel: "Aqualung Core", serialNumber: "AL-88412" },
    {
      kind: "regulator",
      label: "Reg #4",
      brandModel: "ScubaPro MK11/C370",
      serialNumber: "SP-40233",
      status: "needs_service",
      serviceNote:
        "Second stage free-flows on the surface — off the wall until the bench looks at it.",
    },
    {
      kind: "regulator",
      label: "Reg #5",
      brandModel: "ScubaPro MK11/C370",
      serialNumber: "SP-40234",
    },
    { kind: "wetsuit", label: "3mm #1", size: "S", brandModel: "Bare Reactive 3mm" },
    { kind: "wetsuit", label: "3mm #2", size: "M", brandModel: "Bare Reactive 3mm" },
    { kind: "wetsuit", label: "3mm #3", size: "M", brandModel: "Bare Reactive 3mm" },
    { kind: "wetsuit", label: "3mm #4", size: "L", brandModel: "Bare Reactive 3mm" },
    { kind: "wetsuit", label: "3mm #5", size: "L", brandModel: "Bare Reactive 3mm" },
    { kind: "wetsuit", label: "3mm #6", size: "XL", brandModel: "Bare Reactive 3mm" },
    { kind: "boots", label: "Boots #1", size: "7" },
    { kind: "boots", label: "Boots #2", size: "9" },
    { kind: "boots", label: "Boots #3", size: "11" },
    { kind: "mask_fins", label: "Mask+Fins #1", size: "S" },
    { kind: "mask_fins", label: "Mask+Fins #2", size: "M" },
    { kind: "mask_fins", label: "Mask+Fins #3", size: "L" },
    {
      kind: "dive_computer",
      label: "Computer #1",
      brandModel: "Suunto Zoop Novo",
      serialNumber: "SZ-77103",
    },
    {
      kind: "dive_computer",
      label: "Computer #2",
      brandModel: "Suunto Zoop Novo",
      serialNumber: "SZ-77104",
    },
    { kind: "gopro", label: "GoPro A", brandModel: "GoPro HERO12", serialNumber: "GP-5521" },
    { kind: "tank", label: "AL80-01", size: "AL80", serialNumber: "LUX-482201" },
    { kind: "tank", label: "AL80-02", size: "AL80", serialNumber: "LUX-482202" },
    { kind: "tank", label: "AL80-03", size: "AL80", serialNumber: "LUX-482203" },
    { kind: "tank", label: "AL80-04", size: "AL80", serialNumber: "LUX-482204" },
    { kind: "tank", label: "AL80-05", size: "AL80", serialNumber: "LUX-482205" },
    { kind: "tank", label: "AL80-06", size: "AL80", serialNumber: "LUX-482206" },
    { kind: "tank", label: "AL63-01", size: "AL63", serialNumber: "LUX-390118" },
    { kind: "tank", label: "AL63-02", size: "AL63", serialNumber: "LUX-390119" },
  ];

  const inserted = await db
    .insert(gearItems)
    .values(
      fleet.map((unit) => ({
        shopId,
        kind: unit.kind,
        label: unit.label,
        size: unit.size ?? null,
        serialNumber: unit.serialNumber ?? null,
        brandModel: unit.brandModel ?? null,
        status: unit.status ?? ("in_service" as const),
        serviceNote: unit.serviceNote ?? null,
      })),
    )
    .returning({ id: gearItems.id, kind: gearItems.kind, label: gearItems.label });
  const byLabel = new Map(inserted.map((unit) => [unit.label, unit]));
  const idOf = (label: string) => {
    const unit = byLabel.get(label);
    if (!unit) throw new Error(`seed-gear: unit ${label} missing`);
    return unit.id;
  };

  // Care history: regulators and BCDs on an annual bench cycle at staggered
  // dates, tanks on VIP + hydro clocks. AL80-03's inspection lands inside the
  // due-soon window so the register shows the amber grammar without putting a
  // row on Today; Reg #4's pull is recorded as the condition note that
  // benched it.
  const serviceRows: (typeof gearServiceEvents.$inferInsert)[] = [];
  const annual = (label: string, kind: "service" | "visual_inspection", monthsAgo: number) => {
    serviceRows.push({
      shopId,
      gearItemId: idOf(label),
      kind,
      servicedOn: months(-monthsAgo),
      nextDueOn: months(12 - monthsAgo),
    });
  };
  for (const [index, label] of ["Reg #1", "Reg #2", "Reg #3", "Reg #5"].entries()) {
    annual(label, "service", 2 + index);
  }
  for (const [index, label] of [
    "BCD #1",
    "BCD #2",
    "BCD #3",
    "BCD #4",
    "BCD #5",
    "BCD #6",
  ].entries()) {
    annual(label, "service", 3 + index);
  }
  for (const label of ["Computer #1", "Computer #2"]) {
    annual(label, "service", 5);
  }
  const tankLabels = [
    "AL80-01",
    "AL80-02",
    "AL80-03",
    "AL80-04",
    "AL80-05",
    "AL80-06",
    "AL63-01",
    "AL63-02",
  ];
  for (const [index, label] of tankLabels.entries()) {
    // AL80-03 (index 2): VIP due in three weeks — visibly coming due, not yet urgent.
    const vipDue =
      label === "AL80-03" ? shiftCalendarDate(today, 21) : months(12 - ((index * 2) % 10) - 1);
    serviceRows.push({
      shopId,
      gearItemId: idOf(label),
      kind: "visual_inspection",
      servicedOn: shiftCalendarDateMonths(vipDue, -12),
      nextDueOn: vipDue,
    });
    serviceRows.push({
      shopId,
      gearItemId: idOf(label),
      kind: "hydro_test",
      servicedOn: months(-((index % 4) * 9) - 6),
      nextDueOn: months(60 - (index % 4) * 9 - 6),
    });
  }
  serviceRows.push({
    shopId,
    gearItemId: idOf("Reg #4"),
    kind: "note",
    servicedOn: shiftCalendarDate(today, -2),
    note: "Pulled from the wall — free-flow reported after the morning boat.",
  });
  await db.insert(gearServiceEvents).values(serviceRows);

  // A few units already spoken for on the upcoming wreck trip, so the
  // register's "where it is" column and that trip's prep page both have a
  // live assignment to show from day one.
  const wreck = ctx.tripRows.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  if (!wreck) return;
  const wreckBookings = ctx.bookingRows
    .filter((booking) => booking.tripId === wreck.id && booking.status !== "cancelled")
    .slice(0, 2);
  const [firstBooking, secondBooking] = wreckBookings;
  if (!firstBooking) return;

  const window = tripReservationWindow(wreck, ctx.timezone);
  const reservationRows: (typeof gearReservations.$inferInsert)[] = [
    {
      shopId,
      gearItemId: idOf("BCD #2"),
      bookingId: firstBooking.id,
      reservedFrom: window.from,
      reservedUntil: window.until,
    },
    {
      shopId,
      gearItemId: idOf("3mm #1"),
      bookingId: firstBooking.id,
      reservedFrom: window.from,
      reservedUntil: window.until,
    },
    {
      shopId,
      gearItemId: idOf("Reg #1"),
      bookingId: firstBooking.id,
      reservedFrom: window.from,
      reservedUntil: window.until,
    },
  ];
  if (secondBooking) {
    reservationRows.push({
      shopId,
      gearItemId: idOf("BCD #5"),
      bookingId: secondBooking.id,
      reservedFrom: window.from,
      reservedUntil: window.until,
    });
  }
  await db.insert(gearReservations).values(reservationRows);
}
