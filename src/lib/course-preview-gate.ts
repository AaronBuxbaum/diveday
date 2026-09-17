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

/**
 * **The shape a signature must have before any byte of it is compared**, and
 * the reason it is a charset test rather than a length one.
 *
 * `timingSafeEqual` throws on buffers of unequal length, so the guard in front
 * of it used to compare `signature.length` — and that is UTF-16 code units,
 * while `Buffer.from` encodes UTF-8. A 43-*character* signature carrying one
 * multibyte character is 44 *bytes*: the guard passed, `timingSafeEqual` raised
 * `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`, and the throw landed in
 * `refusedPublicRoute`'s database `catch`, which fails open. One unauthenticated
 * request per guess then told a hidden course (200, verifier raised) from a
 * slug that never existed (404, verifier never called) — the exact oracle this
 * module closes, reopened by the module itself, with no token needed
 * (security review, issue #1735).
 *
 * Base64url of a SHA-256 digest, unpadded: 43 characters from a 64-character
 * alphabet, every one of them a single byte. So this makes the 43 explicit and
 * makes bytes and characters the same number by construction. The proxy no
 * longer runs this inside that `catch` either; both halves are the fix, because
 * either alone leaves a way for the next raise to be admission.
 */
const SIGNATURE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Digits only, and bounded. `Number` is forgiving in ways a signed payload
 * should not be — `" 123"`, `"+123"` and `"0x7b"` all parse — and `sign()`
 * re-normalises through a template string, so several spellings of one expiry
 * would verify identically. Harmless, since the signature still binds the
 * normalised value and the scope, but signature malleability is not a property
 * to leave lying around in a capability.
 */
const EXPIRY_SHAPE = /^[0-9]{1,15}$/;

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
  // Expiry last, and only over a signature we minted: an attacker learns
  // nothing from the ordering, and a well-signed stale token is the one case
  // worth telling apart from a forged one if this ever needs a log line.
  return expiresAt > now;
}
