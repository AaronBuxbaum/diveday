import { describe, expect, it } from "vitest";
import { redactCapabilityUrl } from "./capability-urls";
import { nowMs } from "./clock";
import {
  COURSE_PREVIEW_PARAM,
  COURSE_PREVIEW_TTL_MS,
  coursePreviewIsValid,
  signCoursePreview,
} from "./course-preview-gate";

const SHOP = "blue-mantis";
const COURSE = "open-water";

describe("the course preview capability", () => {
  it("verifies a token this deployment minted for this course", () => {
    expect(coursePreviewIsValid(signCoursePreview(SHOP, COURSE), SHOP, COURSE)).toBe(true);
  });

  /**
   * **The scope is what makes this worth having.** The disclosure it closes is
   * a stranger sweeping a shop's namespace with template slugs, so a token for
   * one draft must not answer for the next one — otherwise the first Preview
   * link a shop pastes anywhere is a key to the whole catalogue.
   */
  it("refuses a token minted for another course, or another shop", () => {
    const token = signCoursePreview(SHOP, COURSE);
    expect(coursePreviewIsValid(token, SHOP, "rescue-diver")).toBe(false);
    expect(coursePreviewIsValid(token, "reef-runners", COURSE)).toBe(false);
  });

  it("refuses one whose window has closed, and accepts one a second inside it", () => {
    const now = nowMs();
    expect(
      coursePreviewIsValid(
        signCoursePreview(SHOP, COURSE, now - COURSE_PREVIEW_TTL_MS - 1),
        SHOP,
        COURSE,
        now,
      ),
    ).toBe(false);
    expect(
      coursePreviewIsValid(
        signCoursePreview(SHOP, COURSE, now - COURSE_PREVIEW_TTL_MS + 1000),
        SHOP,
        COURSE,
        now,
      ),
    ).toBe(true);
  });

  /**
   * The expiry is readable and the signature covers it, so moving the clock
   * forward in the token is a forgery rather than an extension.
   */
  it("refuses a token whose expiry has been edited", () => {
    const token = signCoursePreview(SHOP, COURSE);
    const [, signature] = token.split(".");
    expect(coursePreviewIsValid(`${nowMs() + 86_400_000}.${signature}`, SHOP, COURSE)).toBe(false);
  });

  it("refuses every shape that is not a token", () => {
    const now = nowMs();
    for (const value of [
      undefined,
      null,
      "",
      ".",
      "no-separator",
      `${now + 60_000}.`,
      `.${"a".repeat(43)}`,
      // What `?preview=a&preview=b` delivers to a server component, and the
      // shape that used to reach `.split()` and 500 a page.
      [signCoursePreview(SHOP, COURSE)],
      // `Number()` is forgiving about all three of these, which is why the
      // expiry is matched against a digits-only shape rather than parsed and
      // hoped about: each of them would otherwise re-normalise through
      // `sign()`'s template string and give one expiry several spellings.
      `1e400.${"a".repeat(43)}`,
      ` ${now + 60_000}.${"a".repeat(43)}`,
      `+${now + 60_000}.${"a".repeat(43)}`,
      `0x${(now + 60_000).toString(16)}.${"a".repeat(43)}`,
    ]) {
      expect(coursePreviewIsValid(value as never, SHOP, COURSE, now), String(value)).toBe(false);
    }
  });

  /**
   * **The one that fails open if it is wrong** (security review, issue #1735).
   *
   * `timingSafeEqual` throws on buffers of unequal length, and the guard in
   * front of it compared `signature.length` — UTF-16 code units — while
   * `Buffer.from` encodes UTF-8. A 43-*character* signature carrying one
   * multibyte character is 44 *bytes*, so the guard passed and the compare
   * raised `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`. That throw landed in
   * `refusedPublicRoute`'s database `catch`, which fails open, and one
   * unauthenticated request per guess then told a hidden course from a
   * nonexistent one on the status line — the oracle this module exists to
   * close, reopened by the module, with no token at all.
   *
   * Every other case in this file short-circuits at the length guard or the
   * expiry test, so nothing reached the compare with a wrong-but-same-length
   * value before this.
   */
  it("refuses a signature that is 43 characters and not 43 bytes, rather than raising", () => {
    const now = nowMs();
    for (const signature of [
      `${"a".repeat(42)}\u00e9`,
      `${"a".repeat(42)}\u20ac`,
      `\u00e9${"a".repeat(42)}`,
      // Two halves of one astral character: 43 code units, six bytes over.
      `${"a".repeat(41)}\u{1f419}`,
    ]) {
      expect(signature.length, signature).toBe(43);
      expect(Buffer.from(signature).length, signature).toBeGreaterThan(43);
      expect(() =>
        coursePreviewIsValid(`${now + 60_000}.${signature}`, SHOP, COURSE, now),
      ).not.toThrow();
      expect(coursePreviewIsValid(`${now + 60_000}.${signature}`, SHOP, COURSE, now)).toBe(false);
    }
  });

  /**
   * The token says *this shop is holding this draft*, which is the whole
   * disclosure the capability prevents — so an unredacted URL in CloudWatch
   * RUM, the web-vitals beacon or a Sentry breadcrumb gives it away to three
   * pipelines after the edge refused to. Imported rather than spelled, so the
   * param and the redaction list cannot drift apart.
   */
  it("is redacted out of any URL that reaches telemetry", () => {
    const url = `/s/${SHOP}/courses/${COURSE}?${COURSE_PREVIEW_PARAM}=${signCoursePreview(SHOP, COURSE)}`;
    const redacted = redactCapabilityUrl(url);
    expect(redacted).not.toContain(signCoursePreview(SHOP, COURSE).split(".")[1]);
    expect(redacted).toContain(`${COURSE_PREVIEW_PARAM}=`);
  });

  /**
   * It buys one thing — not being refused before the page is asked — and the
   * page's own `isLiveShopStaff` is what decides whether the reader sees the
   * course. So this is deliberately *not* a session, and nothing here should
   * ever grow one.
   */
  it("says nothing about who is reading", () => {
    expect(signCoursePreview(SHOP, COURSE)).not.toContain("@");
    expect(signCoursePreview(SHOP, COURSE).split(".")).toHaveLength(2);
  });
});
