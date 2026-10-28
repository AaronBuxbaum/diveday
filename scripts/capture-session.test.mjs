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
  it("waits for a pending live check to settle and its lock to clear", async () => {
    document.body.innerHTML =
      '<span data-staff-session-check="pending"></span><div data-staff-session-lock></div>';
    const page = pageWithSession({
      settle: () => {
        document
          .querySelector("[data-staff-session-check]")
          .setAttribute("data-staff-session-check", "settled");
        document.querySelector("[data-staff-session-lock]").remove();
      },
    });
    await expect(waitForStaffSession(page, "/shop/blue-mantis/divers")).resolves.toBeUndefined();
    expect(page.locator).toHaveBeenCalledWith('[data-staff-session-check="settled"]');
  });

  it("refuses a settled check that leaves the session locked", async () => {
    document.body.innerHTML =
      '<span data-staff-session-check="settled"></span><div data-staff-session-lock></div>';
    await expect(
      waitForStaffSession(pageWithSession(), "/shop/blue-mantis/divers"),
    ).rejects.toThrow(/session.*locked.*nothing was captured/i);
    expect(document.querySelector("[data-staff-session-lock]")).not.toBeNull();
  });

  it("refuses a check that never settles rather than certifying its overlay", async () => {
    document.body.innerHTML = '<span data-staff-session-check="pending"></span>';
    await expect(
      waitForStaffSession(pageWithSession({ fail: true }), "/shop/blue-mantis/divers"),
    ).rejects.toThrow(/session check.*settle.*nothing was captured/i);
  });

  it("leaves a public page alone, with no session marker required", async () => {
    const page = pageWithSession({ pathname: "/s/blue-mantis" });
    await expect(waitForStaffSession(page, "/s/blue-mantis")).resolves.toBeUndefined();
    expect(page.locator).not.toHaveBeenCalled();
  });
});
