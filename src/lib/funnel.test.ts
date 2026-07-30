import { describe, expect, it } from "vitest";
import { eventSource, guideSource, trialHref } from "./funnel";
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
