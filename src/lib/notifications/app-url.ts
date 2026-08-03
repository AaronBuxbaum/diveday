/**
 * `APP_HOST` — the canonical public origin.
 *
 * Every bearer-token link DiveDay mails (waiver, ready, recap, verify, reset)
 * and the Stripe Connect OAuth callback are built from this, so it is derived
 * from server configuration and **never** from a request header: a
 * Host-header-derived origin is how a token link gets mailed pointing at
 * somebody else's server. A malformed value fails loudly here rather than
 * silently mis-linking.
 */

import type { NotificationEnvironment } from "./provider";

/** A server-only canonical origin for bearer-token links; never derive this from a request header. */
export function publicAppUrl(env: NotificationEnvironment = process.env): string | null {
  const result = checkPublicHost(env.APP_HOST, env.NODE_ENV === "production");
  return result.status === "valid" ? result.origin : null;
}

export type PublicHostCheck =
  | { status: "unset" }
  | { status: "valid"; origin: string }
  | { status: "invalid"; reason: string };

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * APP_HOST feeds bearer-token links and the Stripe Connect OAuth callback, so a
 * malformed value (wrong scheme, embedded credentials, a path/query/fragment)
 * is a configuration bug worth failing loudly on rather than silently mis-linking.
 * Production requires a bare HTTPS origin; a loopback origin is only permitted
 * outside production, so a real deploy can never point at localhost.
 */
export function checkPublicHost(
  rawValue: string | undefined,
  productionRuntime: boolean,
): PublicHostCheck {
  const trimmed = rawValue?.trim();
  if (!trimmed) return { status: "unset" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { status: "invalid", reason: `APP_HOST must be a valid URL, got "${trimmed}".` };
  }

  const loopback = isLoopbackHostname(parsed.hostname);
  const httpsAllowed = parsed.protocol === "https:";
  const loopbackHttpAllowed = !productionRuntime && loopback && parsed.protocol === "http:";
  if (!httpsAllowed && !loopbackHttpAllowed) {
    return {
      status: "invalid",
      reason: productionRuntime
        ? `APP_HOST must use https:// in production, got "${trimmed}".`
        : `APP_HOST must use https://, or http:// on a loopback host (localhost/127.0.0.1), got "${trimmed}".`,
    };
  }
  if (parsed.username || parsed.password) {
    return {
      status: "invalid",
      reason: `APP_HOST must not include credentials, got "${trimmed}".`,
    };
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return {
      status: "invalid",
      reason: `APP_HOST must be a bare origin with no path, got "${trimmed}".`,
    };
  }
  if (parsed.search || parsed.hash) {
    return {
      status: "invalid",
      reason: `APP_HOST must not include a query string or fragment, got "${trimmed}".`,
    };
  }
  return { status: "valid", origin: `${parsed.protocol}//${parsed.host}` };
}
