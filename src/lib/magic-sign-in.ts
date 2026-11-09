import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";

/** Bind the random account token to the verified address and its verification epoch. */
export function bindSignInToken(token: string, email: string, verifiedAt: Date): string {
  if (!authSecret) throw new Error("auth_secret_missing");
  const binding = createHmac("sha256", authSecret)
    .update(JSON.stringify(["magic_sign_in", token, email, verifiedAt.toISOString()]))
    .digest("base64url");
  return `${token}.${binding}`;
}

export function openSignInToken(value: string, email: string, verifiedAt: Date): string | null {
  if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const token = value.split(".")[0];
  return timingSafeEqual(Buffer.from(value), Buffer.from(bindSignInToken(token, email, verifiedAt)))
    ? token
    : null;
}
