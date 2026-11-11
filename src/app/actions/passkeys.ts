"use server";

import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  registerAccountPasskey,
  renameAccountPasskey,
  revokeAccountPasskey,
  verifyPasskeyStepUp,
} from "@/db/passkeys";
import { isStepUpPurpose, safeStepUpReturnPath } from "@/features/security-step-up";
import { requireShopSurface } from "@/features/session";
import { getAuth } from "@/lib/auth";
import { APP_ORIGIN, publicAppUrl } from "@/lib/notifications";
import {
  type PasskeyCeremony,
  passkeyAssertionSchema,
  passkeyCookie,
  passkeyRegistrationSchema,
  passkeyRelyingParty,
} from "@/lib/passkeys";
import { readPendingHandle, signInOrigins, trustedSignInOrigin } from "@/lib/pending-sign-in";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { runtimeMode } from "@/lib/runtime-mode";
import { shopPath } from "@/lib/staff-notices";

async function ceremonyContext(ceremony: PasskeyCeremony) {
  const requestHeaders = await headers();
  const origins = signInOrigins(publicAppUrl() ?? APP_ORIGIN, process.env);
  const rp = passkeyRelyingParty(origins, requestHeaders.get("origin"));
  if (!rp || !trustedSignInOrigin(requestHeaders, false, origins)) return null;
  const ip = await clientIp(requestHeaders);
  if (!(await checkRateLimit(rateLimitKey("passkey", ip), RATE_LIMITS.signInByIp)).allowed)
    return null;
  const cookie = passkeyCookie(ceremony, runtimeMode().secureSessionCookies);
  return { db: await getDb(), rp, cookie, handle: readPendingHandle(requestHeaders, cookie.name) };
}

async function staffBinding(shopSlug: string) {
  const { session } = await requireShopSurface(shopSlug);
  const { userAccountId, sessionId, shopId } = session.user;
  return userAccountId && sessionId ? { userAccountId, accountSessionId: sessionId, shopId } : null;
}

export async function beginPasskeySignInAction() {
  const context = await ceremonyContext("sign-in");
  if (!context) return null;
  const result = await beginPasskeyAuthentication(context.db, context.rp, context.handle);
  (await cookies()).set(context.cookie.name, result.handle, context.cookie.attributes);
  return result.options;
}

export async function completePasskeySignInAction(response: unknown) {
  const parsed = passkeyAssertionSchema.safeParse(response);
  if (!parsed.success) return false;
  let result: Awaited<
    ReturnType<Awaited<ReturnType<typeof getAuth>>["api"]["signInDiveDayPasskey"]>
  >;
  try {
    result = await (await getAuth()).api.signInDiveDayPasskey({
      body: { response: parsed.data },
      headers: await headers(),
    });
  } catch {
    return false;
  }
  redirect(
    result.pending
      ? "/sign-in?error=two-factor"
      : result.shopSlug
        ? shopPath(result.shopSlug)
        : "/shop",
  );
}

export async function beginPasskeyRegistrationAction(shopSlug: string) {
  const context = await ceremonyContext("register");
  const binding = await staffBinding(shopSlug);
  if (!context || !binding) return null;
  const result = await beginPasskeyRegistration(context.db, binding, context.rp, context.handle);
  if (!result) return null;
  (await cookies()).set(context.cookie.name, result.handle, context.cookie.attributes);
  return result.options;
}

export async function completePasskeyRegistrationAction(
  shopSlug: string,
  response: unknown,
  name: string,
) {
  const context = await ceremonyContext("register");
  const binding = await staffBinding(shopSlug);
  const parsed = passkeyRegistrationSchema.safeParse(response);
  if (!context || !binding || !parsed.success || typeof name !== "string") return false;
  const accepted = await registerAccountPasskey(
    context.db,
    binding,
    context.rp,
    context.handle,
    parsed.data,
    name,
  );
  (await cookies()).delete(context.cookie.name);
  if (accepted) refresh();
  return accepted;
}

export async function renamePasskeyAction(shopSlug: string, id: string, name: string) {
  const context = await ceremonyContext("register");
  const binding = await staffBinding(shopSlug);
  if (!context || !binding || !z.uuid().safeParse(id).success || typeof name !== "string")
    return false;
  const accepted = await renameAccountPasskey(context.db, binding, id, name);
  if (accepted) refresh();
  return accepted;
}

export async function deletePasskeyAction(shopSlug: string, id: string) {
  const context = await ceremonyContext("register");
  const binding = await staffBinding(shopSlug);
  if (!context || !binding || !z.uuid().safeParse(id).success) return false;
  const accepted = await revokeAccountPasskey(context.db, binding, id);
  if (accepted) refresh();
  return accepted;
}

export async function beginPasskeyStepUpAction(shopSlug: string, purpose: string) {
  const context = await ceremonyContext("step-up");
  const binding = await staffBinding(shopSlug);
  if (!context || !binding || !isStepUpPurpose(purpose)) return null;
  const result = await beginPasskeyAuthentication(
    context.db,
    context.rp,
    context.handle,
    binding,
    purpose,
  );
  (await cookies()).set(context.cookie.name, result.handle, context.cookie.attributes);
  return result.options;
}

export async function completePasskeyStepUpAction(
  shopSlug: string,
  purpose: string,
  returnTo: string,
  response: unknown,
) {
  const context = await ceremonyContext("step-up");
  const binding = await staffBinding(shopSlug);
  const target = safeStepUpReturnPath(shopSlug, returnTo);
  const parsed = passkeyAssertionSchema.safeParse(response);
  if (!context || !binding || !isStepUpPurpose(purpose) || !target || !parsed.success) return false;
  const accepted = await verifyPasskeyStepUp(
    context.db,
    binding,
    purpose,
    context.rp,
    context.handle,
    parsed.data,
  );
  (await cookies()).delete(context.cookie.name);
  if (accepted) redirect(target);
  return false;
}
