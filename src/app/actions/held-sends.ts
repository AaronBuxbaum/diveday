"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { HeldTicket } from "@/components/SendHold";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  claimHeldSend,
  executeHeldSend,
  type HeldSendOutcome,
  holdSend,
  undoHeldSend,
} from "@/db/held-sends";
import { getShopById } from "@/db/shops";
import { trackEvent } from "@/lib/analytics";
import { type HeldSendPayload, heldSendPayloadSchema } from "@/lib/held-sends";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * The three moves of a send you can take back (ADR 20260906-before-you-ask,
 * decision 2): hold it, undo it, release it. Every one reads the shop off the
 * session, never off the form, and a held row belongs to exactly one shop.
 */

const LAST_MINUTE_NOTICE = {
  invalid_discount: "last-minute-invalid-discount",
  trip_unavailable: "last-minute-trip-unavailable",
  trip_full: "last-minute-trip-full",
  not_connected: "last-minute-not-connected",
  no_recipients: "last-minute-no-recipients",
  stripe_failed: "last-minute-stripe-failed",
} as const;

const uuidList = (formData: FormData, name: string) => [
  ...new Set(formData.getAll(name).map(String).filter(Boolean)),
];

function payloadFromForm(formData: FormData): HeldSendPayload {
  const kind = String(formData.get("holdKind") ?? "");
  const optional = (name: string) => String(formData.get(name) ?? "").trim() || undefined;
  const raw =
    kind === "waiver_send"
      ? {
          kind,
          bookingIds: uuidList(formData, "bookingId"),
          personId: optional("personId"),
          // The diver record's three delivery buttons are three submitters on
          // one form, so the channel is the submitter's own name/value pair;
          // anything else is email, as every older caller meant.
          channel: optional("channel") ?? "email",
          surface: optional("surface") ?? "today",
          tripId: optional("tripId"),
        }
      : kind === "last_minute_deal"
        ? {
            kind,
            tripId: optional("tripId"),
            discountPercent: Number(formData.get("discountPercent")),
            recipientPersonIds: uuidList(formData, "recipientPersonIds"),
          }
        : { kind, tripId: optional("tripId"), entryId: optional("entryId") };
  return heldSendPayloadSchema.parse(raw);
}

export async function holdSendAction(formData: FormData): Promise<HeldTicket> {
  const session = await requireStaffSession();
  const db = await getDb();
  const payload = payloadFromForm(formData);
  if (payload.kind === "last_minute_deal") {
    // Discounting is money work wherever the button sits (issue #714): the
    // same gate the promo page and the old immediate action stood behind.
    const allowed = await canPersonManagePaymentSettings(
      db,
      session.user.shopId,
      session.user.personId,
    );
    if (!allowed) throw new Error("not_authorized");
  }
  const held = await holdSend(db, {
    shopId: session.user.shopId,
    payload,
    actorPersonId: session.user.personId,
  });
  return { id: held.id, runAt: held.runAt.getTime() };
}

export async function undoHeldSendAction(id: string): Promise<boolean> {
  const session = await requireStaffSession();
  return undoHeldSend(await getDb(), session.user.shopId, z.uuid().parse(id));
}

export type ReleasedSend =
  | { status: "pending" | "gone" }
  | {
      status: "done";
      outcome: HeldSendOutcome & {
        /** Where the surface goes next, for a send that used to end in a redirect. */
        redirectTo?: string;
      };
    };

export async function releaseHeldSendAction(id: string): Promise<ReleasedSend> {
  const session = await requireStaffSession();
  const db = await getDb();
  const claim = await claimHeldSend(db, session.user.shopId, z.uuid().parse(id));
  if (claim.status !== "claimed") return { status: claim.status };
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return { status: "gone" };
  const { row } = claim;
  const outcome = await executeHeldSend(db, row);
  const { payload } = row;

  if (payload.kind === "waiver_send") {
    const path =
      payload.surface === "today"
        ? shopPath(shop.slug)
        : payload.surface === "check_in"
          ? shopPath(shop.slug, "check-in")
          : payload.surface === "roster" && payload.tripId
            ? shopPath(shop.slug, "trips", payload.tripId)
            : shopPath(shop.slug, "divers", ...(payload.personId ? [payload.personId] : []));
    revalidatePath(path);
    if (outcome.kind === "waiver_send" && outcome.sent.length > 0) {
      await trackEvent({ name: "staff_recovery", kind: "waiver_sent", surface: payload.surface });
    }
    return { status: "done", outcome };
  }

  const tripPath = shopPath(shop.slug, "trips", payload.tripId);
  revalidatePath(tripPath);
  revalidatePath(shopPath(shop.slug));
  if (outcome.kind === "last_minute_deal") {
    const anchor = `${tripPath}#last-minute-deal`;
    const redirectTo = outcome.outcome.ok
      ? noticeUrl(anchor, "last-minute-sent", { count: outcome.outcome.recipientCount })
      : noticeUrl(anchor, LAST_MINUTE_NOTICE[outcome.outcome.reason]);
    return { status: "done", outcome: { ...outcome, redirectTo } };
  }
  return { status: "done", outcome };
}
