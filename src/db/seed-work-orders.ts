// i18n-exempt-file: seeded bench tickets — what a customer said at the counter
// and what a technician wrote on the card, the shop's own data, never app UI
// copy.
import { and, eq } from "drizzle-orm";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { GearServiceKind } from "@/lib/gear";
import type { WorkOrderOutcome, WorkOrderStatus } from "@/lib/work-orders";
import type { DbExecutor } from "./client";
import {
  customerGearItems,
  gearItems,
  workOrderCare,
  workOrderEvents,
  workOrderItems,
  workOrderLines,
  workOrders,
} from "./schema";

/**
 * **The bench, mid-week** (ADR 20261008-gear-work-orders): three customers'
 * pieces and one of the shop's own regulators, spread across the statuses a
 * real Monday holds — one just dropped off, one open on the bench with parts
 * and labor on it, one waiting on a part that has not come, and one collected
 * with its Work done record, so the board's quiet tail is not empty.
 *
 * The shop's own ticket is on Reg #4, the unit `seed-gear.ts` already pulled
 * off the wall, with the same words as its service note: the ticket is the
 * bench's side of a pull the register already shows, so nothing on the
 * register moves for it.
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

  // Found by the tag `seed-gear.ts` gave it, so the two scenarios cannot drift
  // apart. Missing (the lean template seeds no fleet) means one fewer ticket.
  const [benchUnit] = await db
    .select({ id: gearItems.id, status: gearItems.status, serviceNote: gearItems.serviceNote })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), eq(gearItems.label, "Reg #4")))
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
      // A cylinder: two compliance dates, never a "service".
      {
        shopId,
        personId: third.id,
        kind: "tank" as const,
        brandModel: "Faber FX100",
        serialNumber: "FB-30716",
        inspectionDueOn: day(40),
        hydroDueOn: day(420),
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
    /** The Work done record, on a ticket whose job has ended. */
    work?: {
      outcome: WorkOrderOutcome;
      care: Array<{ pieceId: string; kind: GearServiceKind; passed: boolean; days: number }>;
    };
  };

  const tickets: Ticket[] = [
    {
      personId: second.id,
      status: "picked_up",
      reportedProblem: "Battery hatch leaked on the last trip; display fogged.",
      technician: true,
      workPerformed: "New battery and hatch seal, pressure-tested.",
      receivedDays: -16,
      collectedDays: -9,
      pieceIds: [secondComputer.id],
      lines: [
        { kind: "part", description: "Battery and hatch seal kit", unitAmountCents: 2400 },
        { kind: "labor", description: "Computer battery service", unitAmountCents: 3000 },
      ],
      work: {
        outcome: "done",
        care: [{ pieceId: secondComputer.id, kind: "service", passed: true, days: -10 }],
      },
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
    ...(benchUnit
      ? [
          {
            gearItemId: benchUnit.id,
            status: "in_progress" as const,
            // The register's own words for the pull, so the unit reads the same.
            reportedProblem: benchUnit.serviceNote ?? "Second stage free-flows on the surface.",
            technician: true,
            technicianNotes: "Seat is worn; kit on the shelf.",
            receivedDays: -3,
            pieceIds: [],
          },
        ]
      : []),
    {
      personId: first.id,
      status: "in_progress",
      reportedProblem: "Breathes wet at depth, and the computer’s backlight flickers.",
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
      personId: third.id,
      status: "received",
      reportedProblem: "Second stage free-flows as soon as it gets wet. Overdue for a service.",
      promisedOn: day(5),
      receivedDays: 0,
      pieceIds: [thirdRegulator.id],
    },
  ];

  // Oldest first, so the ticket numbers run the way the counter wrote them.
  for (const [index, ticket] of tickets.entries()) {
    const receivedAt = new Date(nowDate().getTime() + ticket.receivedDays * 86_400_000);
    const collectedAt =
      ticket.collectedDays === undefined
        ? null
        : new Date(nowDate().getTime() + ticket.collectedDays * 86_400_000);
    const [row] = await db
      .insert(workOrders)
      .values({
        shopId,
        number: index + 1,
        personId: ticket.personId ?? null,
        gearItemId: ticket.gearItemId ?? null,
        status: ticket.status,
        reportedProblem: ticket.reportedProblem,
        promisedOn: ticket.promisedOn ?? null,
        technicianPersonId: ticket.technician ? ctx.technicianPersonId : null,
        technicianNotes: ticket.technicianNotes ?? null,
        workPerformed: ticket.workPerformed ?? null,
        receivedAt,
        readyAt: ticket.status === "picked_up" ? collectedAt : null,
        pickedUpAt: collectedAt,
        outcome: ticket.work?.outcome ?? null,
        outcomeRecordedAt: ticket.work ? collectedAt : null,
        outcomeRecordedByPersonId: ticket.work ? ctx.technicianPersonId : null,
        unitPriorStatus: ticket.gearItemId ? (benchUnit?.status ?? null) : null,
        unitPriorServiceNote: ticket.gearItemId ? (benchUnit?.serviceNote ?? null) : null,
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
    if (ticket.work && ticket.work.care.length > 0) {
      await db.insert(workOrderCare).values(
        ticket.work.care.map((care) => ({
          shopId,
          workOrderId: row.id,
          customerGearItemId: care.pieceId,
          kind: care.kind,
          passed: care.passed,
          performedOn: day(care.days),
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
        toStatus: ticket.status === "picked_up" ? "ready" : ticket.status,
        createdAt: receivedAt,
      });
    }
    if (ticket.work && collectedAt) {
      events.push({
        shopId,
        workOrderId: row.id,
        kind: "work_recorded",
        actorPersonId: ctx.technicianPersonId,
        createdAt: collectedAt,
      });
      events.push({
        shopId,
        workOrderId: row.id,
        kind: "status_changed",
        fromStatus: "ready",
        toStatus: "picked_up",
        createdAt: collectedAt,
      });
    }
    await db.insert(workOrderEvents).values(events);
  }
}
