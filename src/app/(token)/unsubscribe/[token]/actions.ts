"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { unsubscribeByToken } from "@/db/unsubscribe";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The one mutating step: `unsubscribeByToken` resolves the token to its one
 * kind and stops exactly that. Redirects back to the same page either way: an
 * invalid/unknown token and a successful unsubscribe both re-render from a
 * fresh DB read, never from a caller-controlled query flag, so nothing here can
 * be forged into a false confirmation.
 */
export async function confirmUnsubscribe(token: string) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("unsubscribe-token", ip), RATE_LIMITS.accountTokenAction))
      .allowed
  ) {
    redirect(`/unsubscribe/${token}`);
  }
  await unsubscribeByToken(await getDb(), { token });
  redirect(`/unsubscribe/${token}`);
}
