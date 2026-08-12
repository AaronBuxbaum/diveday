import { describe, expect, it } from "vitest";
import { telHref } from "./course-inquiry";

/**
 * The subject/body/mailto composers this file used to cover are gone with the
 * buttons that carried them (`CourseInquiry.tsx`): a diver's inquiry is
 * recorded server-side and the shop notified, rather than handed back as a
 * draft to send themselves. What is left of this module is a shape, a code
 * list, and one URL helper.
 */

describe("telHref", () => {
  it("dials a printed number", () => {
    expect(telHref("+1 (305) 555-0134")).toBe("tel:+13055550134");
  });
});
