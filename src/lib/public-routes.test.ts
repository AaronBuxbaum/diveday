import { describe, expect, it } from "vitest";
import { publicSchedulePath, shopSlugFromPublicPath, shopSlugFromStaffUrl } from "./public-routes";

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

/**
 * The reader is `src/app/s/[shopSlug]/not-found.tsx`, which Next hands no
 * props — so the pathname the proxy stamped is the only thing that knows which
 * shop the visitor was trying to reach. A wrong answer here sends a diver to
 * *another shop's* schedule, so every non-answer is null on purpose.
 */
describe("shopSlugFromPublicPath", () => {
  it("recovers the shop from any depth of the public namespace", () => {
    expect(shopSlugFromPublicPath("/s/blue-mantis")).toBe("blue-mantis");
    expect(shopSlugFromPublicPath("/s/blue-mantis/")).toBe("blue-mantis");
    expect(shopSlugFromPublicPath("/s/blue-mantis/trips/not-a-trip")).toBe("blue-mantis");
    expect(shopSlugFromPublicPath("/s/reef-line/courses/open-water")).toBe("reef-line");
  });

  it("returns null rather than guessing when the path names no shop", () => {
    expect(shopSlugFromPublicPath(null)).toBeNull();
    expect(shopSlugFromPublicPath(undefined)).toBeNull();
    expect(shopSlugFromPublicPath("")).toBeNull();
    expect(shopSlugFromPublicPath("/s")).toBeNull();
    expect(shopSlugFromPublicPath("/s/")).toBeNull();
    // The staff namespace is a different subtree with a different 404.
    expect(shopSlugFromPublicPath("/shop/blue-mantis")).toBeNull();
    expect(shopSlugFromPublicPath("/pricing")).toBeNull();
  });

  it("refuses anything that isn't shaped like a slug", () => {
    expect(shopSlugFromPublicPath("/s/Blue-Mantis")).toBeNull();
    expect(shopSlugFromPublicPath("/s/blue_mantis")).toBeNull();
    expect(shopSlugFromPublicPath("/s/blue-")).toBeNull();
    expect(shopSlugFromPublicPath("/s/..")).toBeNull();
    expect(shopSlugFromPublicPath("/s/../../etc")).toBeNull();
    expect(shopSlugFromPublicPath("//evil.example/s/blue-mantis")).toBeNull();
  });

  it("spends the slug on an internal path and nothing else", () => {
    const slug = shopSlugFromPublicPath(
      "/s/blue-mantis/trips/00000000-0000-4000-8000-000000000000",
    );
    expect(publicSchedulePath(slug ?? "")).toBe("/s/blue-mantis");
  });
});
