import { describe, expect, it } from "vitest";
import { eventSource, guideSource, scheduleAttributionHref, trialHref } from "./funnel";
import { MIGRATION_GUIDE_SLUGS } from "./migration-guides";

describe("eventSource", () => {
  it("keeps the tags the marketing pages actually emit", () => {
    expect(eventSource("pricing")).toBe("pricing");
    expect(eventSource("home-hero")).toBe("home-hero");
    expect(eventSource("switching-spreadsheet")).toBe("switching-spreadsheet");
  });

  it("keeps a tag for every registered switching guide", () => {
    // A new guide is a new funnel entry point the moment its page exists —
    // registering the guide is all that should be needed.
    for (const slug of MIGRATION_GUIDE_SLUGS) {
      expect(eventSource(guideSource(slug))).toBe(`switching-${slug}`);
    }
  });

  it("keeps a page's mid-page door distinct from the page itself", () => {
    // The whole reason a mid-page CTA gets its own tag: folded into the page's
    // one bucket, a door added to answer "one CTA at the bottom of ten
    // sections" can never be shown to have earned its place.
    expect(eventSource("product-mid")).toBe("product-mid");
    expect(eventSource("product")).toBe("product");
    expect(trialHref("product-mid")).toBe("/onboard?from=product-mid");
    // Same split on the pricing page: its hero door and the door that closes
    // the objection layer answer different moments in the same visit.
    expect(eventSource("pricing-close")).toBe("pricing-close");
    expect(trialHref("pricing-close")).toBe("/onboard?from=pricing-close");
  });

  it("collapses anything outside the vocabulary to unknown", () => {
    // The value reaches us from the visitor's own request, so free-form text
    // and markup collapse to one bucket rather than becoming event properties.
    expect(eventSource(undefined)).toBe("unknown");
    expect(eventSource(null)).toBe("unknown");
    expect(eventSource("")).toBe("unknown");
    expect(eventSource("Pricing Page")).toBe("unknown");
    expect(eventSource("<script>alert(1)</script>")).toBe("unknown");
    expect(eventSource(42)).toBe("unknown");
  });

  it("collapses a plausible near-miss rather than opening a second bucket", () => {
    // The failure this registry exists to prevent: a typo that reads like a
    // real page and quietly splits one page's numbers in two.
    expect(eventSource("prciing")).toBe("unknown");
    expect(eventSource("home-herp")).toBe("unknown");
    expect(eventSource("switching-eeve")).toBe("unknown");
  });
});

describe("trialHref", () => {
  it("tags the trial CTA with the page that sent the visitor", () => {
    expect(trialHref("pricing")).toBe("/onboard?from=pricing");
    expect(trialHref(guideSource("eve"))).toBe("/onboard?from=switching-eve");
  });

  it("round-trips: every href it builds survives eventSource", () => {
    expect(eventSource(trialHref("nav").split("=")[1])).toBe("nav");
  });
});

describe("scheduleAttributionHref", () => {
  it("tags the schedule preview link with the shop and the page that sent the visitor", () => {
    expect(scheduleAttributionHref("blue-mantis", "home-hero")).toBe(
      "/s/blue-mantis?from=home-hero",
    );
  });

  it("round-trips: every href it builds survives eventSource", () => {
    const href = scheduleAttributionHref("blue-mantis", "home-hero");
    expect(eventSource(href.split("=")[1])).toBe("home-hero");
  });
});
