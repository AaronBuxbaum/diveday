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
    render(<PublicShopFooter shop={shop} t={t} />);

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
        t={t}
      />,
    );

    expect(screen.getByText("Bonaire")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bonaire" })).toBeNull();
  });
});
