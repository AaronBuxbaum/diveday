import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMBED_OPTIONS,
  EMBED_KINDS,
  embedFrameUrl,
  embedSnippet,
  embedTargetUrl,
  partnerLinkUrl,
} from "./embed-snippets";

const ORIGIN = "https://diveday.example";

/**
 * The attributes and URLs here are a contract with `public/embed.js` and with
 * every snippet a shop has already pasted (ADR 20260901-diveday-reimagined,
 * decision 2). Change a name and a shop's site silently goes blank.
 */
describe("the embed grammar", () => {
  it("names eight kinds", () => {
    expect([...EMBED_KINDS]).toEqual([
      "button",
      "lightbox",
      "calendar",
      "grid",
      "departure",
      "courses",
      "qr",
      "partner",
    ]);
  });

  it("frames the calendar as the schedule's compact mode and a widget by its own path", () => {
    expect(embedFrameUrl(ORIGIN, "blue-mantis", "calendar")).toBe(
      "https://diveday.example/s/blue-mantis?embed=1",
    );
    expect(embedFrameUrl(ORIGIN, "blue-mantis", "grid")).toBe(
      "https://diveday.example/s/blue-mantis/embed/grid",
    );
    expect(
      embedFrameUrl(ORIGIN, "blue-mantis", "departure", {
        look: "light",
        lang: "es-ES",
        show: "t1",
      }),
    ).toBe("https://diveday.example/s/blue-mantis/embed/departure?show=t1&lang=es-ES");
  });

  it("passes the host's colour and face only when the look is the site's", () => {
    const host = { brand: "#178f6a", font: "Manrope, sans-serif" };
    expect(embedFrameUrl(ORIGIN, "blue-mantis", "grid", DEFAULT_EMBED_OPTIONS, host)).toBe(
      "https://diveday.example/s/blue-mantis/embed/grid?brand=%23178f6a&font=Manrope%2C+sans-serif",
    );
    expect(
      embedFrameUrl(ORIGIN, "blue-mantis", "grid", { look: "light", lang: "auto" }, host),
    ).toBe("https://diveday.example/s/blue-mantis/embed/grid");
  });

  it("tells the frame when the host page carries the credit, and only then", () => {
    expect(
      embedFrameUrl(ORIGIN, "blue-mantis", "courses", DEFAULT_EMBED_OPTIONS, { credit: true }),
    ).toBe("https://diveday.example/s/blue-mantis/embed/courses?credit=host");
    expect(embedFrameUrl(ORIGIN, "blue-mantis", "courses")).not.toContain("credit");
  });

  it("sends a button to the storefront, or to the one departure chosen", () => {
    expect(embedTargetUrl(ORIGIN, "blue-mantis")).toBe("https://diveday.example/s/blue-mantis");
    expect(embedTargetUrl(ORIGIN, "blue-mantis", { look: "site", lang: "auto", show: "t1" })).toBe(
      "https://diveday.example/s/blue-mantis/trips/t1",
    );
  });

  it("writes a snippet that still works with the loader missing", () => {
    const button = embedSnippet(ORIGIN, "blue-mantis", "button", DEFAULT_EMBED_OPTIONS, {
      button: "Book a dive",
    });
    expect(button).toBe(
      `<script async src="https://diveday.example/embed.js"></script>\n<a href="https://diveday.example/s/blue-mantis" data-diveday="button" data-shop="blue-mantis" data-look="site" data-lang="auto">Book a dive</a>`,
    );
    const grid = embedSnippet(
      ORIGIN,
      "blue-mantis",
      "departure",
      { look: "site", lang: "auto", show: "t1" },
      {
        button: "Book",
      },
    );
    expect(grid).toContain(
      '<div data-diveday="departure" data-shop="blue-mantis" data-look="site" data-lang="auto" data-show="t1"></div>',
    );
  });

  it("escapes what a shop typed into a partner's name and a button's words", () => {
    expect(partnerLinkUrl(ORIGIN, "blue-mantis", "The Reef Hotel & Spa")).toBe(
      "https://diveday.example/s/blue-mantis?utm_source=partner&utm_medium=referral&utm_campaign=the-reef-hotel-spa",
    );
    expect(
      embedSnippet(ORIGIN, "blue-mantis", "button", DEFAULT_EMBED_OPTIONS, {
        button: '<b>"Go"</b>',
      }),
    ).toContain(">&lt;b>&quot;Go&quot;&lt;/b></a>");
  });

  /**
   * **One course, on the same attribute** (issue #1284, completing ADR
   * 20260901-diveday-reimagined decision 2's "what it shows": everything, one
   * departure, one course, a named set).
   *
   * The value is a course slug rather than a trip id, and the two are told
   * apart by the kind alone — which is what makes this additive. The attribute
   * is `data-show`, the name every snippet a shop already pasted either
   * carries or does not; nothing was renamed, so nothing on a live site
   * changes meaning.
   */
  it("narrows the courses widget to one course, by slug", () => {
    const options = { look: "site" as const, lang: "auto", show: "open-water" };
    expect(embedSnippet(ORIGIN, "blue-mantis", "courses", options, { button: "Book" })).toContain(
      '<div data-diveday="courses" data-shop="blue-mantis" data-look="site" data-lang="auto" data-show="open-water"></div>',
    );
    const url = new URL(embedFrameUrl(ORIGIN, "blue-mantis", "courses", options));
    expect(url.pathname).toBe("/s/blue-mantis/embed/courses");
    expect(url.searchParams.get("show")).toBe("open-water");
  });

  it("leaves the whole-board widgets whole, whatever show is set to", () => {
    // The grid and the calendar *are* the board. A `show` on either would be a
    // narrowing nobody chose — the generator does not offer it, and the
    // grammar refuses it rather than trusting that.
    const options = { look: "site" as const, lang: "auto", show: "open-water" };
    for (const kind of ["grid", "calendar"] as const) {
      expect(
        new URL(embedFrameUrl(ORIGIN, "blue-mantis", kind, options)).searchParams.has("show"),
      ).toBe(false);
      expect(embedSnippet(ORIGIN, "blue-mantis", kind, options, { button: "Book" })).not.toContain(
        "data-show",
      );
    }
  });
});
