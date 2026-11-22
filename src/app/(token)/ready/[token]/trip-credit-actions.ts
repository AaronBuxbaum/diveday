"use server";

import { redirect } from "next/navigation";
import { redeemOwnTripCredit } from "@/features/money/trip-credit";
import { revalidateAndRedirect } from "@/features/platform/navigation";
import { base, bounceTarget, contextFor, refuseWhileHeld } from "./action-helpers";

export async function spendTripCreditFromReady(
  token: string,
  attemptId: string,
  currency: string,
  expectedFareCents: number,
) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  if (!ctx.delivered) redirect(`${base(token)}?error=pay`);
  const result = await redeemOwnTripCredit(ctx.db, {
    token,
    attemptId,
    currency,
    expectedFareCents,
  });
  if (!result.ok) redirect(`${base(token)}?error=pay`);
  revalidateAndRedirect(base(token), `${base(token)}?pay=paid`);
}
