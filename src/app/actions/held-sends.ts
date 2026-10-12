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
import { nowMs } from "@/lib/clock";
import { formValue, parseForm, trimmedText } from "@/lib/form-parse";
import { type HeldSendPayload, heldSendPayloadSchema } from "@/lib/held-sends";
import { majorToMinor, toShopCurrency } from "@/lib/money";
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

/** Every value a repeated id field sent, once each and blanks dropped, as `getAll` read it. */
const idList = () =>
  z
    .unknown()
    .optional()
    .transform((value) => {
      const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
      return [...new Set(values.map(String).filter(Boolean))];
    });

/** Text that is absent when blank: a blank or missing box is `undefined`, the rest trimmed. */
const optionalText = () => trimmedText().transform((value) => value || undefined);

/**
 * Every field a hold posts, read raw: `heldSendPayloadSchema` is the one that
 * decides what a hold may carry, so this only gathers the form into its shape.
 */
const heldSendForm = z.object({
  holdKind: formValue().transform((value) => String(value ?? "")),
  bookingId: idList(),
  recipientPersonIds: idList(),
  personId: optionalText(),
  channel: optionalText(),
  surface: optionalText(),
  tripId: optionalText(),
  entryId: optionalText(),
  discount: formValue(),
  discountPercent: formValue(),
  discountKind: formValue(),
});
type HeldSendForm = z.infer<typeof heldSendForm>;

/**
 * A deal's discount off the form: a percent, or a fixed amount the staffer
 * typed in whole currency units and DiveDay stores in minor units. `discount`
 * and `discountKind` are the deal form's two controls; a bare `discountPercent`
 * is the older single-box spelling and still reads as a percent.
 */
function dealDiscountFromForm(
  form: HeldSendForm,
  currency: string,
): { discountPercent?: number; discountAmountCents?: number } {
  const raw = form.discount ?? form.discountPercent;
  const value = Number(String(raw ?? "").trim());
  if (form.discountKind === "amount") {
    return { discountAmountCents: Number.isFinite(value) ? majorToMinor(value, currency) : value };
  }
  return { discountPercent: value };
}

function payloadFromForm(formData: FormData, currency: string): HeldSendPayload {
  const parsed = parseForm(heldSendForm, formData);
  if (!parsed.ok) throw new Error("unreadable hold form");
  const form = parsed.data;
  const kind = form.holdKind;
  const raw =
    kind === "waiver_send"
      ? {
          kind,
          bookingIds: form.bookingId,
          personId: form.personId,
          // The diver record's three delivery buttons are three submitters on
          // one form, so the channel is the submitter's own name/value pair;
          // anything else is email, as every older caller meant.
          channel: form.channel ?? "email",
          surface: form.surface ?? "today",
          tripId: form.tripId,
        }
      : kind === "last_minute_deal"
        ? {
            kind,
            tripId: form.tripId,
            ...dealDiscountFromForm(form, currency),
            recipientPersonIds: form.recipientPersonIds,
          }
        : { kind, tripId: form.tripId, entryId: form.entryId };
  return heldSendPayloadSchema.parse(raw);
}

export async function holdSendAction(formData: FormData): Promise<HeldTicket> {
  const session = await requireStaffSession();
  const db = await getDb();
  // The shop's currency, only to read a fixed-amount deal's major units.
  const currency = toShopCurrency((await getShopById(db, session.user.shopId))?.currency);
  const payload = payloadFromForm(formData, currency);
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
  // `holdMs` on the server's own clock, so the client counts it down on its
  // own — the two are never compared (see `HeldTicket`).
  return {
    id: held.id,
    runAt: held.runAt.getTime(),
    holdMs: Math.max(0, held.runAt.getTime() - nowMs()),
  };
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
  // The actor's own countdown is the clock (see `claimHeldSend`).
  const claim = await claimHeldSend(db, session.user.shopId, z.uuid().parse(id), undefined, {
    early: true,
  });
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
    const anchor = `${tripPath}?view=details#last-minute-deal`;
    const redirectTo = outcome.outcome.ok
      ? noticeUrl(anchor, "last-minute-sent", { count: outcome.outcome.recipientCount })
      : noticeUrl(anchor, LAST_MINUTE_NOTICE[outcome.outcome.reason]);
    return { status: "done", outcome: { ...outcome, redirectTo } };
  }
  return { status: "done", outcome };
}
