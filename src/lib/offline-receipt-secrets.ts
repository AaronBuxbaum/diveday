import { authSecret } from "./auth-secret";

/** Current key first; old receipt keys remain available during a deliberate rotation. */
export function offlineReceiptSecrets(): string[] {
  if (!authSecret) throw new Error("AUTH_SECRET is required for offline receipts");
  const raw = process.env.OFFLINE_PREVIOUS_AUTH_SECRETS;
  if (!raw) return [authSecret];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid offline receipt key configuration");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 8 ||
    parsed.some((value) => typeof value !== "string" || !value || value.length > 4096)
  )
    throw new Error("Invalid offline receipt key configuration");
  return [...new Set([authSecret, ...parsed])];
}
