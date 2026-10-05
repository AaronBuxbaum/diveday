import { describe, expect, it } from "vitest";
import { staffDestinationGates } from "./authz";
import { DEMO_LANDINGS, demoLandingFrom, demoLandingPath } from "./demo-landings";
import { FEATURE_PAGES } from "./feature-pages";
import { visibleStaffDestinations } from "./staff-destinations";

describe("DEMO_LANDINGS", () => {
  it("holds only landings a door uses", () => {
    // An unused entry is one more page a crafted form can name, and nothing
    // the site ships would ever send a visitor there.
    const used = new Set(FEATURE_PAGES.map((page) => page.demo.landing));
    expect(DEMO_LANDINGS.filter((landing) => !used.has(landing))).toEqual([]);
  });
});

describe("demoLandingFrom", () => {
  it.each(DEMO_LANDINGS)("keeps %s, which is on the list", (landing) => {
    expect(demoLandingFrom(landing)).toBe(landing);
  });

  it.each([
    ["../../admin", "a path climbing out of the shop"],
    ["/shop/blue-mantis/settings", "a whole path rather than a code"],
    ["settings", "a real destination that is not a landing"],
    ["GEAR", "a landing in the wrong case"],
    ["constructor", "a prototype-walking value"],
    ["", "an empty field"],
  ])("refuses %s (%s)", (value) => {
    expect(demoLandingFrom(value)).toBeNull();
  });

  it("refuses a field that is not text at all", () => {
    expect(demoLandingFrom(null)).toBeNull();
    expect(demoLandingFrom(new File(["gear"], "gear"))).toBeNull();
  });
});

describe("demoLandingPath", () => {
  it("lands on the destination's own page inside the minted shop", () => {
    expect(demoLandingPath("demo-abc123", "owner", "gear")).toBe("/shop/demo-abc123/gear");
    expect(demoLandingPath("demo-abc123", "owner", "board")).toBe(
      "/shop/demo-abc123/schedule/board",
    );
  });

  it("lands on Today when the door named nothing", () => {
    expect(demoLandingPath("demo-abc123", "owner", null)).toBe("/shop/demo-abc123");
  });

  it.each(DEMO_LANDINGS)("keeps %s inside the shop it was minted for", (landing) => {
    const path = demoLandingPath("demo-abc123", "owner", landing);
    expect(path === "/shop/demo-abc123" || path.startsWith("/shop/demo-abc123/")).toBe(true);
  });

  it.each([
    ["a/../../api/test", "a path climbing out of /shop/"],
    ["a?next=//elsewhere#x", "a query and a fragment"],
    ["..", "a bare parent segment"],
  ])("holds a slug like %s (%s) to one /shop/ segment", (slug) => {
    // The one caller mints the slug itself, so none of these can arrive today.
    // The escape is for the caller that one day passes something else.
    const path = demoLandingPath(slug, "owner", "gear");
    expect(path).toBe(`/shop/${encodeURIComponent(slug)}/gear`);
    expect(path.split("/")).toHaveLength(4);
  });

  it("lands a role on Today when its gate refuses the landing", () => {
    // Only a form someone edited pairs a captain with the release settings;
    // Today greets them instead of a refusal notice.
    expect(demoLandingPath("demo-abc123", "captain", "waivers")).toBe("/shop/demo-abc123");
    expect(demoLandingPath("demo-abc123", "owner", "waivers")).toBe("/shop/demo-abc123/waivers");
    expect(demoLandingPath("demo-abc123", "captain", "today")).toBe("/shop/demo-abc123");
  });

  it("only lands where the demo's owner is let in", () => {
    // A door pairs a landing with the owner (the file comment), so a gated
    // page on this list is fine only while the owner passes its gate. A page
    // the owner cannot open would greet the visitor with a refusal.
    const ownerSees = new Set(
      visibleStaffDestinations(staffDestinationGates(["owner"])).map(({ id }) => id),
    );
    expect(DEMO_LANDINGS.filter((landing) => !ownerSees.has(landing))).toEqual([]);
  });
});
