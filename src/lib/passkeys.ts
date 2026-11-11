import { z } from "zod";

export const PASSKEY_CHALLENGE_TTL_SECONDS = 300;
const base64url = z
  .string()
  .min(1)
  .max(20000)
  .regex(/^[A-Za-z0-9_-]+$/);
export const passkeyAssertionSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  clientExtensionResults: z.object({}).passthrough(),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
});
export const passkeyRegistrationSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.string()).optional(),
  }),
  clientExtensionResults: z.object({}).passthrough(),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
});
export type PasskeyCeremony = "sign-in" | "register" | "step-up";
export type PasskeyBinding = {
  userAccountId: string;
  accountSessionId: string;
  shopId: string;
};

/** Exact server-owned origins only; never derive an RP from a request Host. */
export function passkeyRelyingParty(origins: readonly string[], requestedOrigin: string | null) {
  if (!requestedOrigin || !origins.includes(requestedOrigin)) return null;
  const url = new URL(requestedOrigin);
  // WebAuthn RP IDs must be domains, even though browsers treat loopback IPs as secure contexts.
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")) return null;
  if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
  return { origin: url.origin, rpId: url.hostname };
}

export function passkeyCookie(ceremony: PasskeyCeremony, secure: boolean) {
  return {
    name: `${secure ? "__Host-" : ""}diveday.passkey_${ceremony}`,
    attributes: {
      httpOnly: true,
      secure,
      sameSite: "strict" as const,
      path: "/",
      maxAge: PASSKEY_CHALLENGE_TTL_SECONDS,
    },
  };
}
