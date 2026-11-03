// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShopNotice } from "./outcome";
import { noticeRole } from "./tone";

afterEach(cleanup);

describe("noticeRole", () => {
  it("makes a refusal an alert and everything else a status", () => {
    expect(noticeRole("danger")).toBe("alert");
    for (const tone of ["success", "warning", "neutral"] as const) {
      expect(noticeRole(tone)).toBe("status");
    }
  });
});

describe("ShopNotice", () => {
  it("keeps a persistent success on the page with the role it was given", () => {
    render(
      <ShopNotice persistent role="status">
        Saved
      </ShopNotice>,
    );
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("draws a danger notice as an alert in danger ink", () => {
    render(
      <ShopNotice tone="danger" role={noticeRole("danger")}>
        Could not save
      </ShopNotice>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("text-danger");
  });
});
