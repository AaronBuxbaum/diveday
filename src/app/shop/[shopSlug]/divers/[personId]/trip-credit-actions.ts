"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireStaffSession } from "@/features/accounts/session";
import {
  grantTripCredit,
  redeemTripCredit,
  type TripCreditResult,
} from "@/features/money/trip-credit";
import { parseForm } from "@/features/platform/form-parse";
import { currencyFractionDigits, majorToMinor } from "@/lib/money";
import { STAFF_TRIP_CREDIT_REASONS } from "@/lib/trip-credit";

const fields = z.object({
  kind: z.enum(["grant", "redeem"]),
  personId: z.uuid(),
  attemptId: z.uuid(),
  currency: z.string().regex(/^[a-z]{3}$/),
  amount: z.string().max(100).optional(),
  reason: z.enum(STAFF_TRIP_CREDIT_REASONS).optional(),
  bookingId: z.uuid().optional(),
  expectedFareCents: z.coerce.number().int().positive().optional(),
});
type Refusal = Extract<TripCreditResult, { ok: false }>;
export type TripCreditActionState =
  | null
  | Refusal
  | {
      ok: true;
      kind: "grant" | "redeem";
      amountCents: number;
      balanceCents: number;
      currency: string;
    };

export async function tripCreditAction(
  _previous: TripCreditActionState,
  form: FormData,
): Promise<TripCreditActionState> {
  const session = await requireStaffSession();
  const parsed = parseForm(fields, form);
  if (!parsed.ok) return { ok: false, reason: "invalid" };
  const input = parsed.data;
  const scope = {
    shopId: session.user.shopId,
    actorPersonId: session.user.personId,
    personId: input.personId,
    attemptId: input.attemptId,
    currency: input.currency,
  };
  let result: TripCreditResult;
  if (input.kind === "grant") {
    const raw = input.amount ?? "";
    if (
      !/^\d+(?:\.\d+)?$/.test(raw) ||
      (raw.split(".")[1]?.length ?? 0) > currencyFractionDigits(input.currency) ||
      !input.reason
    )
      return { ok: false, reason: "invalid" };
    result = await grantTripCredit(await getDb(), {
      ...scope,
      amountCents: majorToMinor(Number(raw), input.currency),
      reason: input.reason,
    });
  } else {
    if (!input.bookingId || !input.expectedFareCents) return { ok: false, reason: "invalid" };
    result = await redeemTripCredit(await getDb(), {
      ...scope,
      bookingId: input.bookingId,
      expectedFareCents: input.expectedFareCents,
    });
  }
  if (!result.ok) return result;
  revalidatePath(`/shop/${session.user.shopSlug}/divers/${input.personId}`);
  if (input.bookingId) revalidatePath(`/shop/${session.user.shopSlug}`);
  return {
    ok: true,
    kind: input.kind,
    amountCents: result.amountCents,
    balanceCents: result.balanceCents,
    currency: input.currency,
  };
}
