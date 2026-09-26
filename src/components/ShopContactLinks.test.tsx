// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShopContactLinks } from "./ShopContactLinks";

afterEach(cleanup);

/**
 * The component's own doc says these are "things a thumb can actually press",
 * and they were 20px words (the pixel audit: 112×20 and 128×20 on the trip
 * page and the arrival card, seventeen captures).
 */
describe("ShopContactLinks", () => {
  it("makes the phone and the email 44px targets", () => {
    render(<ShopContactLinks phone="+1 305 555 0142" email="hello@demo.invalid" />);

    const phone = screen.getByRole("link", { name: "+1 305 555 0142" });
    const email = screen.getByRole("link", { name: "hello@demo.invalid" });
    expect(phone.getAttribute("href")).toMatch(/^tel:/);
    expect(email.getAttribute("href")).toMatch(/^mailto:/);
    for (const link of [phone, email]) {
      expect(link).toHaveClass("inline-flex", "min-h-11", "items-center");
    }
  });

  it("renders nothing when the shop has published neither", () => {
    const { container } = render(<ShopContactLinks phone={null} email={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
