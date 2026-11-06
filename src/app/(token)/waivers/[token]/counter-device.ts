import { cookies } from "next/headers";
import { CAPABILITY_POLICY } from "@/lib/capabilities";
import { runtimeMode } from "@/lib/runtime-mode";

/**
 * **The phone a counter link opened on** (attacker review S1). The first phone
 * to open a counter QR claims it (`claimCounterLink`) and keeps the secret in
 * this cookie, scoped to that one link's path, so the same phone can reload and
 * no other phone opens it. HttpOnly: no script on the page ever reads it.
 */
const COUNTER_DEVICE_COOKIE = "diveday_counter_device";

/** The secret this phone keeps for the counter link at `/waivers/<token>`, if any. */
export async function counterDevice(): Promise<string | undefined> {
  return (await cookies()).get(COUNTER_DEVICE_COOKIE)?.value || undefined;
}

/** Keep the claim's secret on this phone, for this link only, while the link can live. */
export async function keepCounterDevice(token: string, device: string): Promise<void> {
  (await cookies()).set(COUNTER_DEVICE_COOKIE, device, {
    httpOnly: true,
    secure: runtimeMode().secureCookies,
    sameSite: "lax",
    path: `/waivers/${token}`,
    maxAge: CAPABILITY_POLICY.waiver_link.ttlMs / 1000,
  });
}
