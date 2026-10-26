import { createHash, randomBytes } from "node:crypto";

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
  if (
    env.DIVEDAY_E2E === "1" &&
    !env.DATABASE_URL &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535
  )
    return [`http://127.0.0.1:${port}`];
  return [new URL(configuredOrigin).origin];
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
