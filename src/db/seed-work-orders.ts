// i18n-exempt-file: seeded bench tickets — what a customer said at the counter
// and what a technician wrote on the card, the shop's own data, never app UI
// copy.
import { and, eq } from "drizzle-orm";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { WorkOrderStatus } from "@/lib/work-orders";
import type { DbExecutor } from "./client";
import {
  customerGearItems,
  gearItems,
  workOrderEvents,
  workOrderItems,
  workOrderLines,
  workOrders,
} from "./schema";

/**
 * **The bench, mid-week** (ADR 20261008-gear-work-orders): three customers'
 * pieces and one of the shop's own cylinders, spread across the statuses a
 * real Monday holds — one just dropped off, one open on the bench with parts
 * and labor on it, one waiting on a part that has not come, one ready for its
 * owner to collect, and one already collected so the board's quiet tail is not
 * empty.
 *
 * Dates hang off the (frozen in e2e) clock so every render is pixel-stable,
 * and nothing here is a trouble state: those are seeded per test through
 * `/api/test/seed-trouble-states`.
 */
export async function seedWorkOrders(
  db: DbExecutor,
  shopId: string,
  ctx: { timezone: string; customers: { id: string }[]; technicianPersonId: string },
): Promise<void> {
  const today = calendarDateInTimezone(nowDate(), ctx.timezone);
  const day = (offset: number) => shiftCalendarDate(today, offset);
  const [first, second, third] = ctx.customers;
  if (!first || !second || !third) return;

  // The shop's own cylinder that goes on a ticket, found by the tag
  // `seed-gear.ts` gave it so the two scenarios cannot drift apart. Missing
  // (the lean template seeds no fleet) simply means one fewer ticket.
  const [benchTank] = await db
    .select({ id: gearItems.id })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), eq(gearItems.label, "AL63-02")))
    .limit(1);

  const pieces = await db
    .insert(customerGearItems)
    .values([
      {
        shopId,
        personId: first.id,
        kind: "regulator" as const,
        brandModel: "Apeks XTX200",
        serialNumber: "AP-77341",
        note: "Octo is an older XTX40.",
        serviceDueOn: day(14),
      },
      {
        shopId,
        personId: first.id,
        kind: "dive_computer" as const,
        brandModel: "Shearwater Perdix",
        serialNumber: "SW-20914",
      },
      {
        shopId,
        personId: second.id,
        kind: "bcd" as const,
        brandModel: "Zeagle Ranger",
        serialNumber: "ZR-4480",
      },
      {
        shopId,
        personId: third.id,
        kind: "regulator" as const,
        brandModel: "Scubapro MK25 / A700",
        serialNumber: "SP-11862",
        serviceDueOn: day(-20),
      },
      {
        shopId,
        personId: second.id,
        kind: "dive_computer" as const,
        brandModel: "Suunto Zoop Novo",
        serialNumber: "SU-55217",
      },
    ])
    .returning({ id: customerGearItems.id, personId: customerGearItems.personId });

  const [firstRegulator, firstComputer, secondBcd, thirdRegulator, secondComputer] = pieces;
  if (!firstRegulator || !firstComputer || !secondBcd || !thirdRegulator || !secondComputer) {
    return;
  }

  type Ticket = {
    personId?: string;
    gearItemId?: string;
    status: WorkOrderStatus;
    reportedProblem: string;
    promisedOn?: string;
    technician?: boolean;
    technicianNotes?: string;
    workPerformed?: string;
    collectedDays?: number;
    receivedDays: number;
    pieceIds: string[];
    lines?: Array<{
      kind: "part" | "labor";
      description: string;
      quantityHundredths?: number;
      unitAmountCents: number;
    }>;
  };

  const tickets: Ticket[] = [
    {
      personId: third.id,
      status: "received",
      reportedProblem: "Second stage free-flows as soon as it gets wet. Overdue for a service.",
      promisedOn: day(5),
      receivedDays: 0,
      pieceIds: [thirdRegulator.id],
    },
    {
      personId: first.id,
      status: "in_progress",
      reportedProblem: "Breathes wet below 20 m, and the computer’s backlight flickers.",
      promisedOn: day(3),
      technician: true,
      technicianNotes: "Exhaust valve is curled. Battery hatch on the Perdix looks fine.",
      workPerformed: "Annual service on both stages; new exhaust valve and mouthpiece.",
      receivedDays: -2,
      pieceIds: [firstRegulator.id, firstComputer.id],
      lines: [
        { kind: "part", description: "Second-stage service kit", unitAmountCents: 4200 },
        { kind: "part", description: "Exhaust valve", unitAmountCents: 900 },
        {
          kind: "labor",
          description: "Annual regulator service",
          quantityHundredths: 150,
          unitAmountCents: 6000,
        },
      ],
    },
    {
      personId: second.id,
      status: "waiting_on_parts",
      reportedProblem: "Inflator sticks open. Needs a new power inflator assembly.",
      technician: true,
      technicianNotes: "Ordered from Zeagle 2 days ago, no ship date yet.",
      receivedDays: -6,
      pieceIds: [secondBcd.id],
      lines: [{ kind: "part", description: "Power inflator assembly", unitAmountCents: 8900 }],
    },
    {
      personId: second.id,
      status: "picked_up",
      reportedProblem: "Battery hatch leaked on the last trip; display fogged.",
      technician: true,
      workPerformed: "New battery and hatch seal, pressure-tested to 40 m.",
      receivedDays: -16,
      collectedDays: -9,
      pieceIds: [secondComputer.id],
      lines: [
        { kind: "part", description: "Battery and hatch seal kit", unitAmountCents: 2400 },
        { kind: "labor", description: "Computer battery service", unitAmountCents: 3000 },
      ],
    },
    ...(benchTank
      ? [
          {
            gearItemId: benchTank.id,
            status: "ready" as const,
            reportedProblem: "Visual inspection due; valve o-ring weeping.",
            technician: true,
            workPerformed: "Visual inspection passed, new valve o-ring, sticker applied.",
            receivedDays: -4,
            pieceIds: [],
            lines: [
              { kind: "labor" as const, description: "Visual inspection", unitAmountCents: 2000 },
            ],
          },
        ]
      : []),
  ];

  for (const ticket of tickets) {
    const receivedAt = new Date(nowDate().getTime() + ticket.receivedDays * 86_400_000);
    const [row] = await db
      .insert(workOrders)
      .values({
        shopId,
        personId: ticket.personId ?? null,
        gearItemId: ticket.gearItemId ?? null,
        status: ticket.status,
        reportedProblem: ticket.reportedProblem,
        promisedOn: ticket.promisedOn ?? null,
        technicianPersonId: ticket.technician ? ctx.technicianPersonId : null,
        technicianNotes: ticket.technicianNotes ?? null,
        workPerformed: ticket.workPerformed ?? null,
        receivedAt,
        readyAt: ticket.status === "ready" || ticket.status === "picked_up" ? receivedAt : null,
        pickedUpAt:
          ticket.collectedDays === undefined
            ? null
            : new Date(nowDate().getTime() + ticket.collectedDays * 86_400_000),
      })
      .returning({ id: workOrders.id });
    if (!row) continue;

    if (ticket.pieceIds.length > 0) {
      await db.insert(workOrderItems).values(
        ticket.pieceIds.map((customerGearItemId) => ({
          shopId,
          workOrderId: row.id,
          customerGearItemId,
        })),
      );
    }
    if (ticket.lines?.length) {
      await db.insert(workOrderLines).values(
        ticket.lines.map((line) => ({
          shopId,
          workOrderId: row.id,
          kind: line.kind,
          description: line.description,
          quantityHundredths: line.quantityHundredths ?? 100,
          unitAmountCents: line.unitAmountCents,
        })),
      );
    }

    // The history a ticket would have grown on its way here: opened, then one
    // row per status it passed through. Written in order, so the `seq` the
    // detail page reads back is the order it happened in.
    const events: Array<typeof workOrderEvents.$inferInsert> = [
      { shopId, workOrderId: row.id, kind: "created", toStatus: "received", createdAt: receivedAt },
    ];
    if (ticket.technician) {
      events.push({
        shopId,
        workOrderId: row.id,
        kind: "technician_assigned",
        technicianPersonId: ctx.technicianPersonId,
        createdAt: receivedAt,
      });
    }
    if (ticket.status !== "received") {
      events.push({
        shopId,
        workOrderId: row.id,
        kind: "status_changed",
        fromStatus: "received",
        toStatus: ticket.status,
        createdAt: receivedAt,
      });
    }
    await db.insert(workOrderEvents).values(events);
  }
}
