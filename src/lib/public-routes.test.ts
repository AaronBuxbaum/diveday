import { describe, expect, it } from "vitest";
import { publicSchedulePath, shopSlugFromStaffUrl } from "./public-routes";

describe("shopSlugFromStaffUrl", () => {
  it("recovers the shop from the callbackUrl Auth.js carries", () => {
    // Auth.js sets `callbackUrl` to the full href of the blocked request.
    expect(shopSlugFromStaffUrl("https://diveday.app/shop/blue-mantis")).toBe("blue-mantis");
    expect(shopSlugFromStaffUrl("https://diveday.app/shop/blue-mantis/schedule/board")).toBe(
      "blue-mantis",
    );
    expect(shopSlugFromStaffUrl("https://diveday.app/shop/blue-mantis?notice=saved")).toBe(
      "blue-mantis",
    );
  });

  it("accepts a relative path too", () => {
    expect(shopSlugFromStaffUrl("/shop/reef-line/divers")).toBe("reef-line");
    expect(shopSlugFromStaffUrl("/shop/reef-line/")).toBe("reef-line");
  });

  it("returns null rather than guessing when no shop is named", () => {
    expect(shopSlugFromStaffUrl(undefined)).toBeNull();
    expect(shopSlugFromStaffUrl(null)).toBeNull();
    expect(shopSlugFromStaffUrl("")).toBeNull();
    // `/shop` with no slug is the post-sign-in bounce, not a shop.
    expect(shopSlugFromStaffUrl("https://diveday.app/shop")).toBeNull();
    expect(shopSlugFromStaffUrl("/shop/")).toBeNull();
    expect(shopSlugFromStaffUrl("/reports")).toBeNull();
    expect(shopSlugFromStaffUrl("/s/blue-mantis")).toBeNull();
  });

  it("refuses anything that isn't shaped like a slug", () => {
    expect(shopSlugFromStaffUrl("/shop/Blue-Mantis")).toBeNull();
    expect(shopSlugFromStaffUrl("/shop/blue_mantis")).toBeNull();
    expect(shopSlugFromStaffUrl("/shop/-blue")).toBeNull();
    expect(shopSlugFromStaffUrl("/shop/blue-")).toBeNull();
    expect(shopSlugFromStaffUrl("/shop/..")).toBeNull();
    expect(shopSlugFromStaffUrl("::not a url::")).toBeNull();
  });

  it("cannot be steered off-site — the slug only ever builds an internal path", () => {
    // A hostile callbackUrl can at most name a different shop; the value is
    // spent on `/s/<slug>`, never on the host.
    const slug = shopSlugFromStaffUrl("https://evil.example/shop/blue-mantis");
    expect(slug).toBe("blue-mantis");
    expect(publicSchedulePath(slug ?? "")).toBe("/s/blue-mantis");
    expect(shopSlugFromStaffUrl("https://evil.example/phish")).toBeNull();
  });
});
