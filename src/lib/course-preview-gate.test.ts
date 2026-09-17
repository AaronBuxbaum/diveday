import { describe, expect, it } from "vitest";
import { nowMs } from "./clock";
import {
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
      // Not an integer, and `Number()` is forgiving about both of these.
      `1e400.${"a".repeat(43)}`,
      ` ${now + 60_000}.${"a".repeat(43)}`,
    ]) {
      expect(coursePreviewIsValid(value as never, SHOP, COURSE, now), String(value)).toBe(false);
    }
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
