import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { DAY_MS, nowMs } from "@/lib/clock";
import { authSecret } from "./auth-secret";
import { cleanVisitorShopName } from "./demo-identity";

/**
 * **The visitor's own shop name, worn by their demo** (H-20261014-demo-wears-visitor-shop; ADR
 * 20260724-per-visitor-demo-shops, amendment 2026-10-16).
 *
 * The name never reaches the database. It rides in an httpOnly cookie set by
 * the demo door, bound to the minted shop's id by an HMAC, and only the staff
 * screens and the email preview of that shop read it. So it is seen in the
 * browser that typed it and nowhere else: not on the storefront (which keeps
 * the generated name and stays unindexed), not in any mail that leaves, not to
 * anyone else holding the slug. A cookie for one shop names nothing in another.
 *
 * The value is `<expires-at ms>.<base64url name>.<HMAC over shop, expiry and
 * name>`, under its own HKDF label, so it is never interchangeable with a demo
 * seat or a session. It lasts as long as a minted demo does.
 */

export const DEMO_SHOP_NAME_COOKIE = "diveday_demo_name";

/** A minted demo is reaped after seven days; the name lasts as long. */
const LIFETIME_MS = 7 * DAY_MS;
export const DEMO_SHOP_NAME_MAX_AGE_SECONDS = LIFETIME_MS / 1000;

/**
 * Only staff screens read the name, so the cookie lives under `/shop`. A
 * cookie is named by its name *and* path: clearing it must name this path,
 * or the browser keeps the old one (security review, 2026-10-16).
 */
export const DEMO_SHOP_NAME_COOKIE_PATH = "/shop";

/** What `cookies().delete` is given to take the name off this browser. */
export const DEMO_SHOP_NAME_COOKIE_CLEAR = {
  name: DEMO_SHOP_NAME_COOKIE,
  path: DEMO_SHOP_NAME_COOKIE_PATH,
} as const;

const PURPOSE = "demo-shop-name:";
const VALUE = /^(\d{1,15})\.([A-Za-z0-9_-]{1,400})\.([A-Za-z0-9_-]{43})$/;

function nameKey(): Buffer {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign a demo shop name.");
  return Buffer.from(hkdfSync("sha256", authSecret, "", "diveday-demo-shop-name", 32));
}

function signature(shopId: string, expiresAt: number, encoded: string): string {
  return createHmac("sha256", nameKey())
    .update(`${PURPOSE}${shopId}.${expiresAt}.${encoded}`)
    .digest("base64url");
}

/**
 * The cookie value naming `shopId`'s demo after what the visitor typed, or
 * `null` when nothing usable was typed (the demo keeps its generated name).
 */
export function signDemoShopName(
  shopId: string,
  typed: unknown,
  now: number = nowMs(),
): string | null {
  const name = cleanVisitorShopName(typed);
  if (!name) return null;
  const expiresAt = now + LIFETIME_MS;
  const encoded = Buffer.from(name, "utf8").toString("base64url");
  return `${expiresAt}.${encoded}.${signature(shopId, expiresAt, encoded)}`;
}

/** The name an unexpired cookie signed for exactly `shopId` carries, else `null`. */
export function demoShopNameFor(
  value: string | undefined,
  shopId: string,
  now: number = nowMs(),
): string | null {
  const match = value ? VALUE.exec(value) : null;
  if (!match) return null;
  const [, expiry, encoded, sig] = match;
  const expiresAt = Number(expiry);
  if (!(expiresAt > now)) return null;
  const expected = signature(shopId, expiresAt, encoded);
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  // Cleaned again on the way out: the signature proves who wrote it, and the
  // cleaning is cheap enough to never trust that it was done.
  return cleanVisitorShopName(Buffer.from(encoded, "base64url").toString("utf8"));
}
