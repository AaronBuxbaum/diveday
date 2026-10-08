"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  addCustomerGearItem,
  addWorkOrderLine,
  assignWorkOrderTechnician,
  createWorkOrder,
  deleteCustomerGearItem,
  deleteWorkOrder,
  deleteWorkOrderLine,
  restoreCustomerGearItem,
  restoreWorkOrder,
  saveWorkOrderDetails,
  saveWorkOrderNotes,
  setWorkOrderStatus,
  updateCustomerGearItem,
  updateWorkOrderLine,
} from "@/db/work-orders";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { GEAR_KIND_ORDER, type GearItemKind } from "@/lib/gear";
import { currencyFractionDigits, MAX_PRICE_MINOR_UNITS, majorToMinor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import {
  isWorkOrderStatus,
  parseWorkOrderQuantity,
  WORK_ORDER_TEXT_LIMITS,
  type WorkOrderStatus,
} from "@/lib/work-orders";

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
  serviceDueOn: z.string().trim().max(10),
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

/** Edit a piece, including the next-service date a finished ticket suggested. */
export async function updateCustomerGearItemAction(formData: FormData) {
  const { session, board, diver } = await requireWorkOrderSurface();
  const parsed = pieceSchema
    .extend({ customerGearItemId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const { returnTo, personId, ...input } = parsed.data;
  const back = returnTo === "new" ? `${board}/new?personId=${personId}` : diver(personId);
  const outcome = await updateCustomerGearItem(await getDb(), {
    shopId: session.user.shopId,
    ...input,
  });
  revalidateAndRedirect(back, noticeUrl(back, outcome.ok ? "piece-saved" : outcome.reason));
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

/** Move a ticket, which is also what moves a service clock when it finishes. */
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
  // The shop's own calendar day, which is what a service clock is written in.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) revalidateAndRedirect(landing, noticeUrl(landing, "invalid"));
  const outcome = await setWorkOrderStatus(db, {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    status: parsed.data.status as WorkOrderStatus,
    todayLocal: calendarDateInTimezone(nowDate(), shop.timezone),
    actorPersonId: session.user.personId,
  });
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "moved" : outcome.reason));
}

/** Hand a ticket to a technician, or take it back off everybody. */
export async function assignWorkOrderTechnicianAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = orderActionSchema
    .extend({ technicianPersonId: z.union([z.uuid(), z.literal("")]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const landing = order(parsed.data.workOrderId);
  const outcome = await assignWorkOrderTechnician(await getDb(), {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    technicianPersonId: parsed.data.technicianPersonId || null,
    actorPersonId: session.user.personId,
  });
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "assigned" : outcome.reason));
}

/** Bench notes and what the customer is told, saved together. */
export async function saveWorkOrderNotesAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = orderActionSchema
    .extend({
      technicianNotes: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.technicianNotes),
      workPerformed: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.workPerformed),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const landing = order(parsed.data.workOrderId);
  const outcome = await saveWorkOrderNotes(await getDb(), {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    technicianNotes: parsed.data.technicianNotes,
    workPerformed: parsed.data.workPerformed,
  });
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "notes-saved" : outcome.reason));
}

/** Edit what came in and the day it was promised. */
export async function saveWorkOrderDetailsAction(formData: FormData) {
  const { session, board, order } = await requireWorkOrderSurface();
  const parsed = orderActionSchema
    .extend({
      reportedProblem: z.string().trim().max(WORK_ORDER_TEXT_LIMITS.reportedProblem),
      promisedOn: z.string().trim().max(10),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(board, noticeUrl(board, "invalid"));

  const landing = order(parsed.data.workOrderId);
  const outcome = await saveWorkOrderDetails(await getDb(), {
    shopId: session.user.shopId,
    workOrderId: parsed.data.workOrderId,
    reportedProblem: parsed.data.reportedProblem,
    promisedOn: parsed.data.promisedOn,
  });
  revalidateAndRedirect(landing, noticeUrl(landing, outcome.ok ? "details-saved" : outcome.reason));
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
