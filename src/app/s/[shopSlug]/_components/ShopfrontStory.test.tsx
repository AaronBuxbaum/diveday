// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { ShopfrontStory } from "./ShopfrontStory";
import { ShopWelcome } from "./ShopWelcome";

const t = diverTranslator("en-US");
const aggregate = { count: 83, average: 4.3, suppressedCount: 0 };
type Shop = ComponentProps<typeof ShopWelcome>["shop"];
const SHOP = {
  name: "Blue Mantis Divers",
  tagline: "Small boats",
  description: "A family-run shop beside the reef.",
  brandHeroImageUrl: "/dive-sites/reef.jpg",
  brandHeroImageAlt: "Elkhorn coral",
  brandBadges: ["padi_5_star"],
  establishedYear: 1998,
  shopfrontPhotoUrls: ["/dive-sites/boat.jpg"],
} as Shop;

afterEach(cleanup);

function storefront(shop: Shop) {
  return render(
    <>
      <h1>Schedule</h1>
      <ShopWelcome
        shop={shop}
        aggregate={aggregate}
        newToDivingHref={null}
        seeScheduleHref="#schedule"
        locale="en-US"
        t={t}
        className=""
      />
      <ShopfrontStory shop={shop} aggregate={aggregate} locale="en-US" t={t} className="" />
    </>,
  );
}

describe("the welcome and the lower shop story", () => {
  it("show identity once and keep the full description and photo strip below the board", () => {
    storefront(SHOP);
    expect(screen.getAllByText("Small boats")).toHaveLength(1);
    expect(screen.getAllByAltText("Elkhorn coral")).toHaveLength(1);
    expect(screen.getAllByText("83 ratings")).toHaveLength(1);
    expect(screen.getAllByText("Since 1998")).toHaveLength(1);
    expect(screen.getAllByText("PADI 5 Star Dive Center")).toHaveLength(1);
    expect(screen.getByText("A family-run shop beside the reef.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: t("schedule.shopPhotos") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Schedule");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(SHOP.name);
  });

  it("omits an empty lower story when its only facts already appear in the welcome", () => {
    storefront({ ...SHOP, description: null, shopfrontPhotoUrls: [] });
    expect(screen.getAllByRole("region", { name: SHOP.name })).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("keeps the identity in the story when there is no welcome", () => {
    storefront({ ...SHOP, tagline: "  ", description: null, brandHeroImageUrl: null });
    expect(screen.getAllByRole("region", { name: SHOP.name })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(SHOP.name);
    expect(screen.getByText("83 ratings")).toBeInTheDocument();
    expect(screen.getByText("Since 1998")).toBeInTheDocument();
    expect(screen.getByText("PADI 5 Star Dive Center")).toBeInTheDocument();
  });

  it("keeps the full description when it also supplies the welcome's short introduction", () => {
    storefront({ ...SHOP, tagline: null, brandHeroImageUrl: null });
    expect(screen.getAllByText("83 ratings")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(SHOP.name);
    expect(screen.getAllByText("A family-run shop beside the reef.")).toHaveLength(2);
  });
});
