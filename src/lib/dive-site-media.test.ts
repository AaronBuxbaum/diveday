import { describe, expect, it } from "vitest";
import { resolveDiveSiteImageUrl } from "./dive-site-media";

describe("resolveDiveSiteImageUrl", () => {
  it("upgrades an older Commons seed URL to its bundled asset", () => {
    expect(
      resolveDiveSiteImageUrl(
        "https://commons.wikimedia.org/wiki/Special:FilePath/Blue%20Tangs%20Molasses%20Reef%201999.jpg?width=1600",
      ),
    ).toBe("/dive-sites/Blue%20Tangs%20Molasses%20Reef%201999.jpg");
  });

  it("leaves staff-provided and already-local URLs alone", () => {
    expect(resolveDiveSiteImageUrl("https://images.example.com/reef.jpg")).toBe(
      "https://images.example.com/reef.jpg",
    );
    expect(resolveDiveSiteImageUrl("/uploads/reef.jpg")).toBe("/uploads/reef.jpg");
    expect(resolveDiveSiteImageUrl(null)).toBeNull();
  });
});
