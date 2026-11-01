import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";
import { nowMs } from "./clock";

/**
 * The short-lived, shop-and-course-bound capability lets the public proxy
 * bypass its hidden-course refusal. See `src/db/public-route-existence.ts` for
 * that edge boundary.
 *
 * It is not authorization: the preview route mints only for live shop staff,
 * and the public page independently rechecks `isLiveShopStaff` before showing
 * a hidden course. A failed route-existence lookup also serves the page, so
 * verification must reject malformed input without throwing; the proxy keeps
 * that check outside its database-only fail-open catch (`src/proxy.ts`).
 *
 * HMAC-SHA256 uses an HKDF-derived `AUTH_SECRET` with a dedicated purpose and
 * binds the decoded shop/course path segments and expiry.
 */
const PURPOSE = "diveday-course-preview:v1";

/** The query parameter the editor hangs a minted token off. */
export const COURSE_PREVIEW_PARAM = "preview";

/** Ten minutes for the preview flow; expiry is hygiene, not authorization. */
export const COURSE_PREVIEW_TTL_MS = 10 * 60 * 1000;

/** Separates the readable expiry from the signature. Unreserved in a URI. */
const SEPARATOR = ".";

/**
 * Unpadded SHA-256 base64url is 43 ASCII bytes. Check its alphabet before
 * `timingSafeEqual`: character length alone can admit multibyte UTF-8 and make
 * the comparison throw. The proxy keeps its database fail-open catch separate;
 * malformed capabilities must still return false (`src/proxy.ts`).
 */
const SIGNATURE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** Decimal-only, bounded expiry text; reject Number()'s alternate spellings. */
const EXPIRY_SHAPE = /^[0-9]{1,15}$/;

function previewKey(): string | null {
  // Production requires AUTH_SECRET; dev/e2e use auth-secret.ts's fixed fallback.
  if (!authSecret) return null;
  return Buffer.from(hkdfSync("sha256", authSecret, "", "diveday-course-preview", 32)).toString(
    "base64url",
  );
}

function sign(key: string, shopSlug: string, courseSlug: string, expiresAt: number): string {
  // The proxy and page both pass decoded path segments, so scope matches either side.
  return createHmac("sha256", key)
    .update(`${PURPOSE}|${shopSlug}|${courseSlug}|${expiresAt}`)
    .digest("base64url");
}

/** Mint `<expiresAt>.<signature>` for a live-staff preview; throws without AUTH_SECRET. */
export function signCoursePreview(shopSlug: string, courseSlug: string, now = nowMs()): string {
  const key = previewKey();
  if (!key) throw new Error("AUTH_SECRET is required to sign a course preview link.");
  const expiresAt = now + COURSE_PREVIEW_TTL_MS;
  return `${expiresAt}${SEPARATOR}${sign(key, shopSlug, courseSlug, expiresAt)}`;
}

/** True only for an unexpired token signed here for this shop and course. */
export function coursePreviewIsValid(
  value: string | readonly string[] | undefined | null,
  shopSlug: string,
  courseSlug: string,
  now = nowMs(),
): boolean {
  if (typeof value !== "string") return false;
  const key = previewKey();
  if (!key) return false;
  const separator = value.indexOf(SEPARATOR);
  if (separator <= 0) return false;
  const digits = value.slice(0, separator);
  if (!EXPIRY_SHAPE.test(digits)) return false;
  const expiresAt = Number(digits);
  if (!Number.isSafeInteger(expiresAt)) return false;
  const signature = value.slice(separator + 1);
  // Shape before bytes. `timingSafeEqual` throws on unequal buffers and a
  // character count is not a byte count; see {@link SIGNATURE_SHAPE}.
  if (!SIGNATURE_SHAPE.test(signature)) return false;
  const expected = sign(key, shopSlug, courseSlug, expiresAt);
  if (signature.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  // Check expiry only after signature verification.
  return expiresAt > now;
}
