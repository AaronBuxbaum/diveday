import { describe, expect, it } from "vitest";
import { departureTimes, readShopSite, schedulePageLinks } from "./preview-site.ts";

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
      departureTimes: [],
      boatNames: [],
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

describe("the boats' day", () => {
  // Wordings as Florida shops' own pages put them, read 2026-11-25.
  it("takes the departure, never the check-in before it", () => {
    expect(
      departureTimes(
        "We offer two daily two-tank trips. Morning check-in is at 7:30 AM with an 8:30 AM departure. Afternoon check-in is at 12:00 PM with a 1:00 PM departure.",
      ),
    ).toEqual(["08:30", "13:00"]);
  });

  it("reads a schedule table and leaves the return time and the store's hours", () => {
    expect(
      departureTimes(
        "Daily Check-in Time at the Shop 8:00 AM Dive Boat Departure from Dock 9:00 AM Estimated Dock Return Time 12:30 PM | Check-in Time at the Shop 12:30 PM Dive Boat Departure from Dock 1:30 PM Estimated Dock Return Time 5:00 PM | Hours Monday – Sunday 8:00 AM – 6:00 PM",
      ),
    ).toEqual(["09:00", "13:30"]);
  });

  it("counts a time listed straight after a departure time", () => {
    expect(
      departureTimes(
        "Typical departures are 9:00 a.m. Monday through Friday, and 8:00 a.m. or 1:00 p.m. on Saturday and Sunday.",
      ),
    ).toEqual(["08:00", "09:00", "13:00"]);
  });

  it("takes a time beside a boat's name, in a shop's own short form", () => {
    expect(
      departureTimes("Tropical Legend | Dive Locations: | 8:30a", ["Tropical Legend"]),
    ).toEqual(["08:30"]);
    expect(departureTimes("Dive shop hours: Mon-Sun 10am-4pm | Sunset: 5:05 pm")).toEqual([]);
  });

  it("finds boats' names where a page introduces them", () => {
    const page = `<p>Daily Dive Charters on the dive boats Steel Slinger &amp; Narcosis.</p>
      <p>Join us aboard the <b>Little Deeper</b>. Little Deeper departs from the marina.</p>
      <h2>The Aqua View is a custom built glassbottom catamaran.</h2>
      <p>Parking near the marina and boat</p><p>Watch: a reef dive</p>`;
    expect(readShopSite(page).boatNames).toEqual([
      "Little Deeper",
      "Steel Slinger",
      "Narcosis",
      "Aqua View",
    ]);
  });

  it("reads the day off the schedule pages as well as the home page", () => {
    const facts = readShopSite("<title>Reef Line</title>", [
      "<p>Boat departure 8:30 AM and 1:00 PM daily.</p>",
    ]);
    expect(facts.departureTimes).toEqual(["08:30", "13:00"]);
  });

  it("follows the same site's schedule and charter pages, schedule first, never another host", () => {
    const home = `<a href="/dive-charters/">Charters</a><a href="/schedule">Schedule</a>
      <a href="https://reefline.example/boats">Our boats</a><a href="/service-department">Service</a>
      <a href="/trips/bonaire">Bonaire</a><a href="https://fareharbor.com/reefline/schedule">Book</a>
      <a href="/schedule/">Again</a><a href="/">Home</a>`;
    expect(schedulePageLinks(home, "https://www.reefline.example/")).toEqual([
      "https://www.reefline.example/schedule",
      "https://www.reefline.example/dive-charters",
      "https://reefline.example/boats",
    ]);
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
    expect(parsePreviewArgs(["batch", "shops.txt"])).toEqual({
      command: "batch",
      file: "shops.txt",
    });
    expect(
      parsePreviewArgs(["build", "none", "--name", "Reef Line", "--times", "8:30 AM, 1 PM"]),
    ).toMatchObject({ flags: { "--times": "8:30 AM, 1 PM" } });
  });

  it("reads a batch line as the words after build, quotes holding a value together", async () => {
    const { batchLineWords } = await import("./preview.ts");
    expect(
      batchLineWords(`reefline.example --name "Reef Line Divers" --times '8:30 AM, 1:00 PM'`),
    ).toEqual(["reefline.example", "--name", "Reef Line Divers", "--times", "8:30 AM, 1:00 PM"]);
    expect(batchLineWords("   ")).toEqual([]);
    expect(batchLineWords("# Key Largo shops")).toEqual([]);
    expect(batchLineWords('reefline.example --name "Reef Line')).toBeNull();
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
      ["build", "reefline.example", "--times", "half past eight"],
      ["batch"],
      ["batch", "a", "b"],
    ]) {
      expect(parsePreviewArgs(argv)).toBeNull();
    }
  });
});
