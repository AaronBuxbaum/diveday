import { createHash, randomBytes } from "node:crypto";
import { runtimeMode } from "./runtime-mode";

export const PENDING_SIGN_IN_TTL_SECONDS = 300;
export const PENDING_SIGN_IN_ATTEMPTS = 5;

export function createPendingHandle(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPendingHandle(handle: string): string {
  return createHash("sha256").update(handle, "utf8").digest("hex");
}

export function pendingCookie(origin: string, localTest: boolean) {
  const host = new URL(origin).hostname;
  const secure = !(localTest && ["localhost", "127.0.0.1", "[::1]"].includes(host));
  return {
    name: secure ? "__Host-diveday.pending_sign_in" : "diveday.pending_sign_in",
    attributes: {
      httpOnly: true,
      secure,
      sameSite: "strict" as const,
      path: "/",
      maxAge: PENDING_SIGN_IN_TTL_SECONDS,
    },
  };
}

/** Read the raw header: cookie parsers often collapse duplicate names first. */
export function readPendingHandle(
  headers: Headers | null | undefined,
  name: string,
): string | null {
  const values = (headers?.get("cookie") ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    return separator >= 0 && part.slice(0, separator).trim() === name
      ? [part.slice(separator + 1).trim()]
      : [];
  });
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
}

/** The test fleet prints a canonical example hostname but serves a configured loopback port. */
export function signInOrigins(
  configuredOrigin: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const port = Number(env.PORT);
  if (runtimeMode(env).e2eHarness && Number.isInteger(port) && port > 0 && port <= 65535)
    return [`http://127.0.0.1:${port}`];
  const origin = new URL(configuredOrigin);
  // The same site under `www.`: a visitor who types it reaches the app (the
  // domain serves both) and must be able to sign in, or open the demo, from
  // it. Only for a public https name; the first entry stays the configured one
  // because the pending-sign-in cookie is minted from it.
  const canonical = [origin.origin];
  if (origin.protocol === "https:" && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(origin.hostname)) {
    const www = origin.hostname.startsWith("www.")
      ? origin.hostname.slice(4)
      : `www.${origin.hostname}`;
    if (/[a-z]/i.test(www.replace(/^www\./, ""))) canonical.push(`https://${www}`);
  }
  return canonical;
}

/** Missing Origin is trusted only for in-process calls with no browser fetch metadata. */
export function trustedSignInOrigin(
  headers: Headers | null | undefined,
  hasRequest: boolean,
  baseURL: string | readonly string[],
): boolean {
  const origin = headers?.get("origin");
  if (!origin) return !hasRequest && !headers?.has("sec-fetch-site");
  try {
    return (
      (typeof baseURL === "string" ? [new URL(baseURL).origin] : baseURL).includes(
        new URL(origin).origin,
      ) && headers?.get("sec-fetch-site") !== "cross-site"
    );
  } catch {
    return false;
  }
}
