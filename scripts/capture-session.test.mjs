// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForStaffSession } from "./capture-session.mjs";

afterEach(() => {
  document.body.innerHTML = "";
});

function pageWithSession({
  pathname = "/shop/blue-mantis/divers",
  settle = () => {},
  fail = false,
} = {}) {
  return {
    url: () => `http://localhost:3000${pathname}`,
    locator: vi.fn((selector) => ({
      waitFor: vi.fn(async () => {
        settle();
        if (fail || !document.querySelector(selector)) throw new Error("timed out");
      }),
      count: vi.fn(async () => document.querySelectorAll(selector.replace(":visible", "")).length),
    })),
  };
}

describe("staff capture readiness", () => {
  it("refuses a page that stays the session locked", async () => {
    document.body.innerHTML = "<div data-staff-session-lock></div>";
    await expect(
      waitForStaffSession(pageWithSession(), "/shop/blue-mantis/divers"),
    ).rejects.toThrow(/session.*locked.*nothing was captured/i);
    expect(document.querySelector("[data-staff-session-lock]")).not.toBeNull();
  });

  it("leaves a public page alone, with no session marker required", async () => {
    const page = pageWithSession({ pathname: "/s/blue-mantis" });
    await expect(waitForStaffSession(page, "/s/blue-mantis")).resolves.toBeUndefined();
    expect(page.locator).not.toHaveBeenCalled();
  });
});
