import { describe, expect, it } from "vitest";
import { readShopSite } from "./preview-site.ts";

const PAGE = `<!doctype html><html><head>
<title>Home | Reef Line Divers &amp; Charters</title>
<meta property="og:site_name" content="Reef Line Divers">
<meta name="description" content="Two-tank reef and wreck charters out of Islamorada.">
<meta name="theme-color" content="#0A5C8F">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"LocalBusiness","name":"Reef Line Divers LLC","address":{"addressLocality":"Islamorada","addressRegion":"FL"},"geo":{"latitude":"24.92","longitude":-80.63}}]}</script>
</head><body></body></html>`;

describe("readShopSite", () => {
  it("reads the name, colour, line, town and position a page declares", () => {
    expect(readShopSite(PAGE)).toEqual({
      name: "Reef Line Divers",
      brandColor: "#0a5c8f",
      tagline: "Two-tank reef and wreck charters out of Islamorada.",
      locality: "Islamorada",
      region: "FL",
      latitude: 24.92,
      longitude: -80.63,
    });
  });

  it("falls back to the title's shop part and the colour the styles use most", () => {
    const facts = readShopSite(`<title>Welcome - Capt. Ana's Dive Center</title>
      <style>body{color:#222;background:#fff}a{color:#e4572e}.btn{background:#E4572E}.x{color:#1b998b}</style>`);
    expect(facts.name).toBe("Capt. Ana's Dive Center");
    expect(facts.brandColor).toBe("#e4572e");
    expect(facts.locality).toBeNull();
  });

  it("never takes paper or ink for the brand, and survives broken structured data", () => {
    const facts = readShopSite(`<meta name="theme-color" content="#ffffff">
      <script type="application/ld+json">{not json</script>
      <style>body{color:#111;background:#fafafa}</style>`);
    expect(facts.brandColor).toBeNull();
    expect(facts.name).toBeNull();
  });

  it("drops half a position and an over-long line", () => {
    const facts = readShopSite(`<meta name="description" content="${"x".repeat(200)}">
      <script type="application/ld+json">{"geo":{"latitude":24.9}}</script>`);
    expect(facts.tagline).toBeNull();
    expect(facts.latitude).toBeNull();
  });
});

describe("parsePreviewArgs", () => {
  it("reads a site and its flags, and gives a bare host a scheme", async () => {
    const { parsePreviewArgs } = await import("./preview.ts");
    expect(
      parsePreviewArgs(["build", "reefline.example", "--name", "Reef Line", "--color", "#0a5c8f"]),
    ).toEqual({
      command: "build",
      site: "https://reefline.example",
      flags: { "--name": "Reef Line", "--color": "#0a5c8f" },
    });
    expect(parsePreviewArgs(["build", "none", "--name", "Reef Line"])).toEqual({
      command: "build",
      site: null,
      flags: { "--name": "Reef Line" },
    });
    expect(parsePreviewArgs(["list"])).toEqual({ command: "list" });
  });

  it("refuses an unknown flag, a flag with no value, a repeat, and no command", async () => {
    const { parsePreviewArgs } = await import("./preview.ts");
    for (const argv of [
      [],
      ["build"],
      ["build", "--name", "Reef Line"],
      ["build", "reefline.example", "--logo", "x"],
      ["build", "reefline.example", "--name"],
      ["build", "reefline.example", "--name", "a", "--name", "b"],
      ["list", "extra"],
      ["delete", "x"],
    ]) {
      expect(parsePreviewArgs(argv)).toBeNull();
    }
  });
});
