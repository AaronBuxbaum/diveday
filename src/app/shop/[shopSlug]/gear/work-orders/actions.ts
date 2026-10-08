"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  addCustomerGearItem,
  addWorkOrderLine,
  createWorkOrder,
  deleteCustomerGearItem,
  deleteWorkOrder,
  deleteWorkOrderLine,
  recordWorkOrderWork,
  restoreCustomerGearItem,
  restoreWorkOrder,
  saveWorkOrder,
  setWorkOrderStatus,
  updateWorkOrderLine,
  type WorkOrderCareInput,
} from "@/db/work-orders";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { GEAR_KIND_ORDER, type GearItemKind, type GearServiceKind } from "@/lib/gear";
import { currencyFractionDigits, MAX_PRICE_MINOR_UNITS, majorToMinor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import {
  isWorkOrderOutcome,
  isWorkOrderStatus,
  parseWorkOrderQuantity,
  WORK_ORDER_TEXT_LIMITS,
  type WorkOrderStatus,
} from "@/lib/work-orders";
import { announceReady } from "./_lib/announce-ready";

/**
 * Every write the bench makes (ADR 20261008-gear-work-orders).
 *
 * Ungated like the rest of gear: handing equipment over the counter and
 * working it are day jobs, and a technician is staff (H-06). Tenancy is the
 * session's shop in every call — never a slug, never a form field — so a stale
 * tab cannot move another shop's ticket.
 */

// Copied because `GEAR_KIND_ORDER` is `as const`, which is what makes a gear
// kind with no position a compile error (issue #1799); zod wants a mutable
// tuple.
const kindValues = [...GEAR_KIND_ORDER] as [GearItemKind, ...GearItemKind[]];

async function requireWorkOrderSurface() {
  const session = await requireStaffSession();
  return {
    session,
    board: shopPath(session.user.shopSlug, "gear", "work-orders"),
    order: (workOrderId: string) =>
      shopPath(session.user.shopSlug, "gear", "work-orders", workOrderId),
    diver: (personId: string) => shopPath(session.user.shopSlug, "divers", personId),
  };
}

const pieceSchema = z.object({
  personId: z.uuid(),
  kind: z.enum(kindValues),
  brandModel: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.brandModel),
  serialNumber: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.serialNumber),
  note: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.itemNote),
  /** Where to land afterwards: the new-ticket form, or the diver's record. */
  returnTo: z.enum(["new", "diver"]).optional(),
});

/** Record a piece of a diver's own gear, from the new-ticket form or their record. */
export async function addCustomerGearItemAction(formData: FormData) {
  const { session, board, diver } = await requireWorkOrderSurface();
  const parsed = pieceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const { returnTo, ...input } = parsed.data;
  const back =
    returnTo === "diver"
      ? diver(input.personId)
      : `${board}/new?personId=${encodeURIComponent(input.personId)}`;
  const outcome = await addCustomerGearItem(await getDb(), {
    shopId: session.user.shopId,
    ...input,
  });
  revalidateAndRedirect(back, noticeUrl(back, outcome.ok ? "piece-added" : outcome.reason));
}

const pieceActionSchema = z.object({ customerGearItemId: z.uuid(), personId: z.uuid() });

/** Take a piece off a diver's record — soft, and refused while it is on an open ticket. */
export async function deleteCustomerGearItemAction(formData: FormData) {
  const { session, board, diver } = await requireWorkOrderSurface();
  const parsed = pieceActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const back = diver(parsed.data.personId);
  const outcome = await deleteCustomerGearItem(await getDb(), {
    shopId: session.user.shopId,
    customerGearItemId: parsed.data.customerGearItemId,
    deletedByPersonId: session.user.personId,
  });
  revalidateAndRedirect(
    back,
    outcome.ok
      ? noticeUrl(back, "piece-deleted", { undoPieceId: parsed.data.customerGearItemId })
      : noticeUrl(back, outcome.reason),
  );
}

/** The undo beside that delete. */
export async function restoreCustomerGearItemAction(formData: FormData) {
  const { session, board, diver } = await requireWorkOrderSurface();
  const parsed = pieceActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const back = diver(parsed.data.personId);
  const outcome = await restoreCustomerGearItem(await getDb(), {
    shopId: session.user.shopId,
    customerGearItemId: parsed.data.customerGearItemId,
  });
  revalidateAndRedirect(back, noticeUrl(back, outcome.ok ? "piece-restored" : outcome.reason));
}

const newOrderSchema = z.object({
  personId: z.uuid().optional(),
  gearItemId: z.uuid().optional(),
  customerGearItemIds: z.array(z.uuid()).optional(),
  reportedProblem: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.reportedProblem),
  promisedOn: z.string().trim().max(10),
  technicianPersonId: z.union([z.uuid(), z.literal("")]),
});

/** Open a ticket. The one door that creates one. */
export async function createWorkOrderAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = newOrderSchema.safeParse({
    ...Object.fromEntries(formData),
    customerGearItemIds: formData.getAll("customerGearItemIds").map(String),
  });
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(`${board}/new`, "invalid"));

  const outcome = await createWorkOrder(await getDb(), {
    shopId: session.user.shopId,
    personId: parsed.data.personId,
    gearItemId: parsed.data.gearItemId,
    customerGearItemIds: parsed.data.customerGearItemIds,
    reportedProblem: parsed.data.reportedProblem,
    promisedOn: parsed.data.promisedOn,
    technicianPersonId: parsed.data.technicianPersonId || undefined,
    actorPersonId: session.user.personId,
  });
  if (!outcome.ok) {
    // The refusal belongs beside the form that earned it, with the subject
    // still chosen — a staffer who typed a paragraph into "what the customer
    // reports" should not get an empty form back.
    const subject = parsed.data.personId
      ? `?personId=${parsed.data.personId}`
      : parsed.data.gearItemId
        ? `?unitId=${parsed.data.gearItemId}`
        : "";
    const back = `${board}/new${subject}`;
    revalidateAndRedirect(back, noticeUrl(back, outcome.reason));
  }
  const landing = order(outcome.workOrder.id);
  revalidateAndRedirect(landing, noticeUrl(landing, "opened"));
}

const orderActionSchema = z.object({ workOrderId: z.uuid() });

/**
 * Move a ticket. Only that: no move, pickup included, writes a service clock
 * or touches a unit's register status; the Work done record does that.
 */
export async function setWorkOrderStatusAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = orderActionSchema
    .extend({ status: z.string() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success || !isWorkOrderStatus(parsed.data.status)) {
    revalidateAndRedirect(board, noticeUrl(board, "invalid"));
  }
  const landing = order(parsed.data.workOrderId);
  const db = await getDb();
  const outcome = await setWorkOrderStatus(db, {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    status: parsed.data.status as WorkOrderStatus,
    actorPersonId: session.user.personId,
  });
  // The customer hears it is ready, once per move (ADR 20261008-work-order-follow-up).
  if (outcome.ok && outcome.workOrder.status === "ready") {
    await announceReady(db, { shopId: session.user.shopId, workOrderId: outcome.workOrder.id });
  }
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "moved" : outcome.reason));
}

/**
 * The ticket's record, one form and one Save: what came in, the day promised,
 * who has it, the bench notes and what the customer is told.
 */
export async function saveWorkOrderAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = orderActionSchema
    .extend({
      reportedProblem: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.reportedProblem),
      promisedOn: z.string().trim().max(10),
      technicianPersonId: z.union([z.uuid(), z.literal("")]),
      technicianNotes: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.technicianNotes),
      workPerformed: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.workPerformed),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const landing = order(parsed.data.workOrderId);
  const outcome = await saveWorkOrder(await getDb(), {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    reportedProblem: parsed.data.reportedProblem,
    promisedOn: parsed.data.promisedOn,
    technicianPersonId: parsed.data.technicianPersonId || null,
    technicianNotes: parsed.data.technicianNotes,
    workPerformed: parsed.data.workPerformed,
    actorPersonId: session.user.personId,
  });
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "saved" : outcome.reason));
}

// The register's care kinds, as its own unit page parses them.
const careKindValues: [GearServiceKind, ...GearServiceKind[]] = [
  "service",
  "hydro_test",
  "visual_inspection",
  "o2_clean",
  "note",
];

/** One row of the Work done form, as the form posts it (`care.<n>.<field>`). */
const careRowSchema = z.object({
  /** Empty when the technician left the check unrecorded; the row is then skipped. */
  result: z.enum(["", "passed", "failed"]),
  kind: z.enum(careKindValues),
  customerGearItemId: z.union([z.uuid(), z.literal("")]).optional(),
  nextDueOn: z.string().trim().max(10).optional(),
  nextDueDives: z.string().trim().max(6).optional(),
});

/**
 * The rows of the Work done form, grouped by their index. The form is a fixed
 * grid of checks per piece, so a row is only recorded once the technician has
 * said passed or failed on it.
 */
function careRowsFrom(formData: FormData): Record<string, Record<string, string>> {
  const rows: Record<string, Record<string, string>> = {};
  for (const [name, value] of formData.entries()) {
    const match = /^care\.(\d{1,3})\.([a-zA-Z]+)$/.exec(name);
    if (!match || typeof value !== "string") continue;
    const index = match[1] as string;
    const field = match[2] as string;
    rows[index] ??= {};
    rows[index][field] = value;
  }
  return rows;
}

/**
 * **The Work done record**: how the job ended and the checks behind it. The
 * only act on a ticket that ever writes a clock, and only with the values the
 * technician confirmed on this form.
 */
export async function recordWorkOrderWorkAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = orderActionSchema
    .extend({
      outcome: z.string(),
      outcomeNote: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.outcomeNote),
      performedOn: z.string().trim().max(10),
    })
    .safeParse({
      workOrderId: formData.get("workOrderId"),
      outcome: formData.get("outcome") ?? "",
      outcomeNote: formData.get("outcomeNote") ?? "",
      performedOn: formData.get("performedOn") ?? "",
    });
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));
  const landing = order(parsed.data.workOrderId);
  const outcome = parsed.data.outcome;
  if (!isWorkOrderOutcome(outcome)) {
    revalidateAndRedirect(landing, noticeUrl(landing, "no-outcome"));
  }

  const care: WorkOrderCareInput[] = [];
  // Checks only count toward a job that was done; a declined or condemned job
  // records no care, whatever the grid still holds.
  if (outcome === "done") {
    for (const raw of Object.values(careRowsFrom(formData))) {
      const row = careRowSchema.safeParse(raw);
      if (!row.success) revalidateAndRedirect(landing, noticeUrl(landing, "invalid-care"));
      if (row.data.result === "") continue;
      const passed = row.data.result === "passed";
      const dives = row.data.nextDueDives ?? "";
      if (dives !== "" && !/^\d{1,5}$/.test(dives)) {
        revalidateAndRedirect(landing, noticeUrl(landing, "invalid-dives"));
      }
      care.push({
        customerGearItemId: row.data.customerGearItemId || null,
        kind: row.data.kind,
        passed,
        performedOn: parsed.data.performedOn,
        // A failed check carries no next date, whatever was prefilled beside it.
        nextDueOn: passed ? row.data.nextDueOn || undefined : undefined,
        nextDueDives: passed && dives !== "" ? Number(dives) : undefined,
      });
    }
  }

  const db = await getDb();
  // The shop's own calendar day, which "not in the future" is measured in.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) revalidateAndRedirect(landing, noticeUrl(landing, "invalid"));
  const recorded = await recordWorkOrderWork(db, {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    outcome,
    outcomeNote: parsed.data.outcomeNote,
    care,
    todayLocal: calendarDateInTimezone(nowDate(), shop.timezone),
    actorPersonId: session.user.personId,
  });
  revalidateAndRedirect(
    landing,
    noticeUrl(landing, recorded.ok ? "work-recorded" : recorded.reason),
  );
}

const lineSchema = z.object({
  workOrderId: z.uuid(),
  kind: z.enum(["part", "labor"]),
  description: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.lineDescription),
  quantity: z.string().trim().max(10),
  unitAmount: z.string().trim().max(12),
});

/**
 * A typed price in the shop's own currency, as minor units.
 *
 * The currency comes off the shop, never off the form, and the conversion goes
 * through `majorToMinor`, never a literal 100: a ¥3,000 o-ring kit is 3000 yen
 * and not 300,000 (ADR 20260731-shop-currency). A zero-decimal currency's box
 * therefore takes a whole number and refuses a fraction.
 */
function parseAmountMinorUnits(value: string, currency: string): number | null {
  const trimmed = value.trim();
  const digits = currencyFractionDigits(currency);
  const pattern = digits > 0 ? new RegExp(`^\\d{1,8}(\\.\\d{1,${digits}})?$`) : /^\d{1,8}$/;
  if (!pattern.test(trimmed)) return null;
  const minorUnits = majorToMinor(Number(trimmed), currency);
  return minorUnits > MAX_PRICE_MINOR_UNITS ? null : minorUnits;
}

export async function addWorkOrderLineAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = lineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const landing = order(parsed.data.workOrderId);
  const quantityHundredths = parseWorkOrderQuantity(parsed.data.quantity);
  if (quantityHundredths === null) {
    revalidateAndRedirect(landing, noticeUrl(landing, "invalid-quantity"));
  }
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) revalidateAndRedirect(landing, noticeUrl(landing, "invalid"));
  const unitAmountCents = parseAmountMinorUnits(parsed.data.unitAmount, shop.currency);
  if (unitAmountCents === null) {
    revalidateAndRedirect(landing, noticeUrl(landing, "invalid-amount"));
  }

  const outcome = await addWorkOrderLine(db, {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    kind: parsed.data.kind,
    description: parsed.data.description,
    quantityHundredths,
    unitAmountCents,
  });
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "line-added" : outcome.reason));
}

export async function updateWorkOrderLineAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = lineSchema
    .extend({ workOrderLineId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const landing = order(parsed.data.workOrderId);
  const quantityHundredths = parseWorkOrderQuantity(parsed.data.quantity);
  if (quantityHundredths === null) {
    revalidateAndRedirect(landing, noticeUrl(landing, "invalid-quantity"));
  }
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) revalidateAndRedirect(landing, noticeUrl(landing, "invalid"));
  const unitAmountCents = parseAmountMinorUnits(parsed.data.unitAmount, shop.currency);
  if (unitAmountCents === null) {
    revalidateAndRedirect(landing, noticeUrl(landing, "invalid-amount"));
  }

  const outcome = await updateWorkOrderLine(db, {
    shopId: session.user.shopId,
    workOrderLineId: parsed.data.workOrderLineId,
    kind: parsed.data.kind,
    description: parsed.data.description,
    quantityHundredths,
    unitAmountCents,
  });
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "line-saved" : outcome.reason));
}

export async function deleteWorkOrderLineAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = orderActionSchema
    .extend({ workOrderLineId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const landing = order(parsed.data.workOrderId);
  const outcome = await deleteWorkOrderLine(await getDb(), {
    shopId: session.user.shopId,
    workOrderLineId: parsed.data.workOrderLineId,
  });
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "line-deleted" : outcome.reason));
}

/** Delete a ticket raised in error. The board's Deleted view is the way back. */
export async function deleteWorkOrderAction(formData: FormData) {
  const { session, board } = await requireWorkOrderSurface();
  const parsed = orderActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const outcome = await deleteWorkOrder(await getDb(), {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    deletedByPersonId: session.user.personId,
  });
  revalidateAndRedirect(
    board,
    outcome.ok
      ? noticeUrl(board, "deleted", { undoId: parsed.data.workOrderId })
      : noticeUrl(board, outcome.reason),
  );
}

export async function restoreWorkOrderAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = orderActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const outcome = await restoreWorkOrder(await getDb(), {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
  });
  const landing = outcome.ok ? order(parsed.data.workOrderId) : board;
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "restored" : outcome.reason));
}
