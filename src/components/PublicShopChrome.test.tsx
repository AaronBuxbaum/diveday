// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { PublicShopFooter } from "./PublicShopChrome";

afterEach(cleanup);

const t = diverTranslator("en-US");

const shop = {
  slug: "blue-mantis",
  name: "Blue Mantis Divers",
  contactEmail: "hello@demo.invalid",
  contactPhone: "+1 305 555 0142",
  addressStreet: "100 Ocean Drive",
  addressLocality: "Key Largo",
  addressRegion: "FL",
  addressPostalCode: "33037",
  addressCountry: "US",
};

/**
 * **"Where are you?" is the first question a visiting diver asks**, and it is
 * the one that decides whether a shop is even a candidate.
 *
 * The address was modelled, it was in the page's JSON-LD, and it was on
 * `/ready` — the page a diver reaches *after* they have paid. So a crawler
 * reading `/s/blue-mantis` learned the postal address and a tourist comparing
 * three Key Largo shops on their phone had to leave the site to find out which
 * one was walkable (issue #704).
 */
describe("the public shop footer", () => {
  it("tells a diver where the shop is, and links a map at it", () => {
    render(<PublicShopFooter shop={shop} spokenLanguagesLine={null} t={t} />);

    const link = screen.getByRole("link", { name: /100 Ocean Drive/ });
    expect(link).toHaveAttribute("target", "_blank");
    // A link out, never an embedded map: a third-party frame on an anonymous
    // marketing page costs Core Web Vitals and adds a tracker.
    expect(link.getAttribute("href")).toContain("google.com/maps");
    expect(link.getAttribute("href")).toContain(encodeURIComponent("Blue Mantis Divers"));
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("renders nothing at all for a shop with no address on file", () => {
    render(
      <PublicShopFooter
        shop={{
          ...shop,
          addressStreet: null,
          addressLocality: null,
          addressRegion: null,
          addressPostalCode: null,
          addressCountry: null,
        }}
        spokenLanguagesLine={null}
        t={t}
      />,
    );

    // Not a placeholder and **not an empty element** — the same call
    // `shopAddressOf` already makes for the structured data. Counted rather
    // than queried by name: an empty `<span>` renders invisibly and satisfies
    // every "is the address absent" assertion, which is how a first version of
    // this test passed against both behaviours.
    const contactLine = screen.getByText("+1 305 555 0142").closest("p");
    expect(contactLine?.children).toHaveLength(2);
    expect(screen.getByText("+1 305 555 0142")).toBeInTheDocument();
    expect(screen.getByText("hello@demo.invalid")).toBeInTheDocument();
  });

  /**
   * A shop still being set up has no address, phone or email on file. The
   * contact line rendered anyway, empty, and in the footer's phone column its
   * 8px gap sat under the credit line with nothing below it (the pixel probe,
   * public-schedule-new-shop).
   */
  it("leaves no empty contact line for a shop with no way to reach it on file", () => {
    const { container } = render(
      <PublicShopFooter
        shop={{
          ...shop,
          contactEmail: null,
          contactPhone: null,
          addressStreet: null,
          addressLocality: null,
          addressRegion: null,
          addressPostalCode: null,
          addressCountry: null,
        }}
        spokenLanguagesLine={null}
        t={t}
      />,
    );

    const columns = container.querySelector("footer > div");
    expect(columns?.children).toHaveLength(1);
    expect(columns?.querySelectorAll(":scope > :empty")).toHaveLength(0);
  });

  /**
   * The address, the phone, the email and the credit line were bare text
   * links, 20px tall, on every storefront page (the pixel probe: 158×20 for
   * "Bookings by DiveDay", 109.9×20 for the phone). A diver reaching for the
   * shop's number on a phone gets the button floor like any other target.
   */
  it("gives every footer link the 44px target floor", () => {
    const { container } = render(<PublicShopFooter shop={shop} spokenLanguagesLine={null} t={t} />);

    const links = [...container.querySelectorAll("footer a")];
    expect(links).toHaveLength(4);
    for (const link of links) expect(link).toHaveClass("inline-flex", "min-h-11", "items-center");
    // The credit's box carries its own air now, so the 4px nudge above it goes.
    expect(screen.getByRole("link", { name: /Bookings by DiveDay/ }).className).not.toMatch(
      /(^|\s)mt-/,
    );
    // Wrapped contact lines are a 44px box apart already; a row gap would add air between them.
    expect(screen.getByText("+1 305 555 0142").closest("p")).toHaveClass("gap-y-0");
    // Beside the contact row from `sm` up, the shop's name takes the same 44px line, so the
    // row's text does not sit 12px below it.
    expect(screen.getByText("Blue Mantis Divers")).toHaveClass(
      "sm:flex",
      "sm:min-h-11",
      "sm:items-center",
    );
  });

  it("shows the words without a map link when there is too little to point at", () => {
    // A country and a shop name would centre a map on the middle of a continent
    // and present it as the shop's front door — `shopMapQuery`'s own rule. The
    // words still help a reader; the link would mislead them.
    render(
      <PublicShopFooter
        shop={{
          ...shop,
          addressStreet: null,
          addressLocality: null,
          addressRegion: null,
          addressPostalCode: null,
          addressCountry: "Bonaire",
        }}
        spokenLanguagesLine={null}
        t={t}
      />,
    );

    expect(screen.getByText("Bonaire")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bonaire" })).toBeNull();
  });
});

/**
 * The marketing half of issue #708 — "we speak German" is the whole pitch for
 * a shop selling to international divers, and it belongs where a diver
 * chooses a shop, not only on a trip page they reach after booking.
 */
describe("the shop-wide spoken-languages line", () => {
  it("shows the pre-joined line when at least one staff member has recorded a language", () => {
    render(<PublicShopFooter shop={shop} spokenLanguagesLine="Deutsch, 日本語" t={t} />);
    expect(screen.getByText("We speak Deutsch, 日本語")).toBeInTheDocument();
  });

  it("renders nothing at all when no staff member has recorded any language", () => {
    render(<PublicShopFooter shop={shop} spokenLanguagesLine={null} t={t} />);
    expect(screen.queryByText(/We speak/)).toBeNull();
  });
});

/**
 * The footer used to parse `shops.conservation_commitments` against a second,
 * older six-code enum that shared exactly one spelling with the eight codes
 * the settings form writes. An owner ticked "PADI AWARE partner", saw the
 * saved notice, and the footer showed nothing -- which looks identical to
 * having ticked nothing.
 */
describe("the footer's conservation commitments", () => {
  it("renders every code the settings form can write", () => {
    render(
      <PublicShopFooter
        shop={{
          ...shop,
          conservationCommitments: ["padi_aware_partner", "no_touch_policy", "reef_cleanup_dives"],
        }}
        spokenLanguagesLine={null}
        t={t}
      />,
    );

    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toHaveLength(3);
    for (const item of items) expect(item).not.toBe("");
  });

  it("shows nothing when a shop has stated none", () => {
    render(
      <PublicShopFooter
        shop={{ ...shop, conservationCommitments: [] }}
        spokenLanguagesLine={null}
        t={t}
      />,
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
