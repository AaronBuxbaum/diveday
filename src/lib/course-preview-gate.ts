import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";
import { nowMs } from "./clock";

/**
 * **A capability that says "this reader is previewing a hidden course"**, so
 * the edge can refuse one to everybody else (issue #1735).
 *
 * A shop takes a course off its public site with the Hidden toggle
 * (`courses.is_active`). The public page still renders it for the shop's own
 * live staff and calls `notFound()` for everyone else. Since the public
 * namespace started refusing unknown URLs in `src/proxy.ts`, that refusal is
 * decided before anything streams — and the existence lookup deliberately does
 * not apply `is_active`, because the previewer has to get through. So the
 * status line separated the two cases: a hidden course answered **200** with
 * the shop's own refusal streamed under it, and a course that never existed
 * answered **404**. Course slugs are minted from a shared template catalogue,
 * so a stranger with a dozen guesses and `curl -w '%{http_code}'` learned which
 * unpublished drafts a shop was holding.
 *
 * The invariant block on `src/db/public-route-existence.ts` sets out why the
 * cheap fixes are all worse than the disclosure — `getSessionCookie` verifies
 * nothing, the cookie cache is five minutes wide and names one shop while staff
 * roles are per-shop — and closes by naming what is wanted instead: *the
 * previewer arrives carrying something the edge can verify*. This is that
 * thing.
 *
 * **The same grammar the waiver, recap and ready links already use**, and the
 * same one as `trip-admission-gate.ts`: HMAC-SHA256 under a key derived from
 * `AUTH_SECRET` through HKDF with a purpose of its own, so a signature minted
 * here verifies as nothing else in the product and nothing else verifies as
 * one. The scope is the two path segments the route resolved, which is what
 * stops a token for one shop's draft opening another's.
 *
 * **It is not an authorisation.** It buys exactly one thing: the edge does not
 * refuse the request. The page's own `isLiveShopStaff` check is live and
 * per-shop and still runs, so a token in the hands of a stranger renders them
 * the same `notFound()` they get today. That is why the expiry below can be
 * forgiving rather than tight — a leaked token discloses the existence of a
 * course whose URL the holder already has, and nothing else.
 */
const PURPOSE = "diveday-course-preview:v1";

/** The query parameter the editor hangs a minted token off. */
export const COURSE_PREVIEW_PARAM = "preview";

/**
 * Ten minutes: long enough for a staffer to tap through, read the page and
 * reload it once, short enough that a link pasted into a channel stops being a
 * 200 signal by the time anyone else reads the channel. Nothing behind the
 * token depends on it — see the docblock above — so this is hygiene rather than
 * a security boundary, and a staffer who waits too long taps Preview again.
 */
export const COURSE_PREVIEW_TTL_MS = 10 * 60 * 1000;

/** Separates the readable expiry from the signature. Unreserved in a URI. */
const SEPARATOR = ".";

function previewKey(): string | null {
  // Production refuses to boot without `AUTH_SECRET`; `auth-secret.ts` supplies
  // a fixed fallback in dev and e2e. So this is null only in a deployment that
  // is already broken, and the two halves below answer it differently on
  // purpose.
  if (!authSecret) return null;
  return Buffer.from(hkdfSync("sha256", authSecret, "", "diveday-course-preview", 32)).toString(
    "base64url",
  );
}

function sign(key: string, shopSlug: string, courseSlug: string, expiresAt: number): string {
  // Percent-decoded segments on both sides: `publicRouteShape` decodes what it
  // reads off `nextUrl.pathname`, and Next hands a page its `params` decoded
  // already, so `/s/blue%2Dmantis` signs and verifies as the same shop the page
  // would have rendered.
  return createHmac("sha256", key)
    .update(`${PURPOSE}|${shopSlug}|${courseSlug}|${expiresAt}`)
    .digest("base64url");
}

/**
 * The value to hang off `?preview=` — `<expiresAt>.<signature>`, minted where
 * the editor already knows the reader is this shop's live staff.
 *
 * Throws with no secret, rather than minting something nothing can verify: a
 * Preview link that silently leads to a 404 is worse than a page that says what
 * is wrong.
 */
export function signCoursePreview(shopSlug: string, courseSlug: string, now = nowMs()): string {
  const key = previewKey();
  if (!key) throw new Error("AUTH_SECRET is required to sign a course preview link.");
  const expiresAt = now + COURSE_PREVIEW_TTL_MS;
  return `${expiresAt}${SEPARATOR}${sign(key, shopSlug, courseSlug, expiresAt)}`;
}

/**
 * Does this `?preview=` value prove the reader was handed a preview link for
 * *this* course by *this* deployment, and recently?
 *
 * False for everything else: absent, repeated (`?preview=a&preview=b` arrives
 * as an array and is truthy — the shape that 500s a naive `.split()`),
 * unsigned, signed for another shop or another course, expired, or — unlike the
 * signer above — minted under a secret this process does not have. Verification
 * fails **closed**, because a deployment that cannot check a capability has not
 * been shown one.
 */
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
  const expiresAt = Number(value.slice(0, separator));
  // `Number("")` is 0 and `Number("1e400")` is Infinity, so the integer test is
  // the one that has to hold rather than the parse succeeding.
  if (!Number.isSafeInteger(expiresAt)) return false;
  const signature = value.slice(separator + 1);
  const expected = sign(key, shopSlug, courseSlug, expiresAt);
  // Length-guard before timingSafeEqual, which throws on unequal buffers.
  if (signature.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  // Expiry last, and only over a signature we minted: an attacker learns
  // nothing from the ordering, and a well-signed stale token is the one case
  // worth telling apart from a forged one if this ever needs a log line.
  return expiresAt > now;
}
