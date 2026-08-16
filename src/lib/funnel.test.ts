import { describe, expect, it } from "vitest";
import {
  eventSource,
  guideSource,
  scheduleAttributionHref,
  switchingHref,
  trialHref,
} from "./funnel";
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

  it("keeps each switching guide door distinct by position", () => {
    expect(guideSource("eve")).toBe("switching-eve");
    expect(guideSource("eve", "mid")).toBe("switching-eve-mid");
    expect(guideSource("eve", "close")).toBe("switching-eve-close");
    expect(eventSource("switching-eve-mid")).toBe("switching-eve-mid");
    expect(eventSource("switching-eve-close")).toBe("switching-eve-close");
    expect(trialHref(guideSource("eve", "mid"))).toBe("/onboard?from=switching-eve-mid");
    expect(trialHref(guideSource("eve", "close"))).toBe("/onboard?from=switching-eve-close");
    expect(eventSource("switching-spreadsheet-mid")).toBe("switching-spreadsheet-mid");
    expect(eventSource("switching-spreadsheet-close")).toBe("switching-spreadsheet-close");
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

describe("switchingHref", () => {
  it("keeps the records band's two doors apart", () => {
    // The question the second door was added to answer (2026-08-15) is which
    // one a spreadsheet shop takes: the hub, which forks, or the guide direct.
    // One tag across both would answer it with a number that cannot be split.
    expect(switchingHref("/switching", "home-records")).toBe("/switching?from=home-records");
    expect(switchingHref("/switching/spreadsheet", "home-records-arriving")).toBe(
      "/switching/spreadsheet?from=home-records-arriving",
    );
  });

  it("tags the other pages' in-page switching doors", () => {
    // Until 2026-08-15 these two were bare hrefs, so `/switching/spreadsheet`
    // had one measurable inbound door and one invisible one — and the page the
    // invisible one sits on is `/product`, where a reader lands *after* the
    // homepage convinced them.
    expect(switchingHref("/switching/spreadsheet", "product-spreadsheet")).toBe(
      "/switching/spreadsheet?from=product-spreadsheet",
    );
    expect(switchingHref("/switching", "about-switching")).toBe("/switching?from=about-switching");
  });

  it("puts the fragment after the query, so the tag survives it", () => {
    // A hash before the `?` would make the query part of the fragment, and the
    // page view would carry no tag at all — the failure this helper exists to
    // make unrepresentable.
    expect(switchingHref("/switching/spreadsheet", "home-records-arriving", "columns")).toBe(
      "/switching/spreadsheet?from=home-records-arriving#columns",
    );
  });

  it("round-trips: every href it builds survives eventSource", () => {
    const href = switchingHref("/switching/spreadsheet", "home-records-arriving");
    expect(eventSource(href.split("=")[1])).toBe("home-records-arriving");
    // …including through a fragment, which the query string precedes.
    const anchored = switchingHref("/switching/spreadsheet", "home-records-arriving", "columns");
    expect(eventSource(new URL(anchored, "https://dive.day").searchParams.get("from"))).toBe(
      "home-records-arriving",
    );
    for (const source of ["product-spreadsheet", "about-switching"] as const) {
      const tagged = switchingHref("/switching", source);
      expect(eventSource(new URL(tagged, "https://dive.day").searchParams.get("from"))).toBe(
        source,
      );
    }
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
