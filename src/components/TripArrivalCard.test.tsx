// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { arrivalCardFacts, TripArrivalCard } from "./TripArrivalCard";

afterEach(cleanup);

const shop = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  timezone: "America/New_York",
  contactPhone: null,
  contactEmail: null,
  dockCallNote: null,
  address: {
    street: "100 Ocean Drive",
    locality: "Key Largo",
    region: "FL",
    postalCode: "33037",
    country: "US",
  },
};

const trip = {
  id: "trip-1",
  title: "Reef morning",
  startsAt: new Date("2030-08-01T13:00:00.000Z"),
  endsAt: new Date("2030-08-01T17:00:00.000Z"),
  meetingPointLabel: null,
  meetingPointAddress: null,
  arrivalLandmark: "  Blue sign  ",
  arrivalParkingNote: null,
  arrivalTransitNote: "  Bus 4  ",
  arrivalLookFor: null,
  arrivalFirstInteraction: "  Ask the dock host  ",
  arrivalPhotoUrl: null,
};

describe("arrivalCardFacts", () => {
  it("falls back to the shop address and map when no custom meeting point exists", () => {
    expect(arrivalCardFacts(shop, trip)).toMatchObject({
      label: "Blue Mantis Divers",
      address: "100 Ocean Drive, Key Largo, FL 33037, US",
      mapQuery: "Blue Mantis Divers, 100 Ocean Drive, Key Largo, FL 33037, US",
      landmark: "Blue sign",
      transitNote: "Bus 4",
      firstInteraction: "Ask the dock host",
    });
  });

  it("uses the trip's custom meeting point without changing the shop fallback", () => {
    expect(
      arrivalCardFacts(shop, {
        ...trip,
        meetingPointLabel: "  North Jetty  ",
        meetingPointAddress: "  12 Dock Road  ",
      }),
    ).toMatchObject({
      label: "North Jetty",
      address: "12 Dock Road",
      mapQuery: "North Jetty, 12 Dock Road",
    });
  });

  /**
   * **The shop's standing sentence, and only where the departure wrote none**
   * (issue #1212). Two answers to one question is the defect, so the
   * departure's own words always win.
   */
  it("falls back to the shop's standing dock-call sentence, and never over the trip's own", () => {
    const withStanding = { ...shop, dockCallNote: "  Come to the blue gate, we’ll wave.  " };
    expect(arrivalCardFacts(withStanding, trip)).toMatchObject({
      firstInteraction: "Ask the dock host",
    });
    expect(
      arrivalCardFacts(withStanding, { ...trip, arrivalFirstInteraction: null }),
    ).toMatchObject({ firstInteraction: "Come to the blue gate, we’ll wave." });
    expect(
      arrivalCardFacts(shop, { ...trip, arrivalFirstInteraction: null }).firstInteraction,
    ).toBeNull();
  });

  it("keeps a map destination when only the custom meeting label is set", () => {
    expect(
      arrivalCardFacts(shop, {
        ...trip,
        meetingPointLabel: "  North Jetty  ",
      }),
    ).toMatchObject({
      label: "North Jetty",
      address: "100 Ocean Drive, Key Largo, FL 33037, US",
      mapQuery: "North Jetty, 100 Ocean Drive, Key Largo, FL 33037, US",
    });
  });
});

/**
 * **Where the day is planned to go, and who said so** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 5.
 *
 * A shop-typed title need not name a site, and this row is the only place the
 * order and the provenance appear together. It carries no time: the plan's own
 * timestamp is the change ledger's to state, and a second one here would be the
 * same fact twice.
 */
describe("the Sites row", () => {
  it("reads in the order the day runs them, over the Plan chip", () => {
    render(
      <TripArrivalCard
        shop={shop}
        trip={trip}
        locale="en-US"
        sites={["Molasses Reef", "French Reef"]}
      />,
    );
    expect(screen.getByText("Sites")).toBeInTheDocument();
    // The order is the day's, never alphabetical.
    expect(screen.getByText("Molasses Reef, French Reef")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("renders nothing at all when the caller names no sites", () => {
    const { rerender } = render(<TripArrivalCard shop={shop} trip={trip} locale="en-US" />);
    expect(screen.queryByText("Sites")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();

    rerender(<TripArrivalCard shop={shop} trip={trip} locale="en-US" sites={[]} />);
    expect(screen.queryByText("Sites")).not.toBeInTheDocument();
  });
});

/**
 * **The thread's one map** (2026-09-17 design review).
 *
 * It used to sit in a trailing "Your dive shop" card that also restated this
 * card's address, phone, email and map link. The frame moved here; the card it
 * came from is gone. It stays opt-in, because `src/lib/maps.ts` deliberately
 * decides nothing about *whether* a surface should draw a map and this frame is
 * a third party's — and it yields to the shop's own arrival photo, since two
 * 16:9 blocks stacked is the card shouting and a photo of the dock answers
 * "did I find it?" better than a street map does.
 */
describe("the map", () => {
  function mapFrame() {
    return document.querySelector("iframe");
  }

  it("draws nothing unless the caller asks", () => {
    render(<TripArrivalCard shop={shop} trip={trip} locale="en-US" />);
    expect(mapFrame()).toBeNull();
  });

  it("draws the meeting point, titled by the place rather than the shop", () => {
    render(<TripArrivalCard shop={shop} trip={trip} locale="en-US" showMap />);
    const frame = mapFrame();
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("title")).toBe("Map of Blue Mantis Divers");
    // The query is the shop's own address, never a guess.
    expect(frame?.getAttribute("src")).toContain("100%20Ocean%20Drive");
    // An element's own policy overrides the document's, and the one caller is
    // `/ready/[token]` — a `TOKEN_ROUTE_PREFIXES` route served under
    // `Referrer-Policy: no-referrer` because a bearer-token page has no
    // legitimate cross-origin use for a referrer, origin-only included. A map
    // embed needs none, so it asks for none.
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("names a custom meeting point, not the shop behind it", () => {
    render(
      <TripArrivalCard
        shop={shop}
        trip={{ ...trip, meetingPointLabel: "North Jetty", meetingPointAddress: "12 Dock Road" }}
        locale="en-US"
        showMap
      />,
    );
    expect(mapFrame()?.getAttribute("title")).toBe("Map of North Jetty");
  });

  it("yields to the shop's own arrival photo", () => {
    render(
      <TripArrivalCard
        shop={shop}
        trip={{ ...trip, arrivalPhotoUrl: "/uploads/dock.jpg" }}
        locale="en-US"
        showMap
      />,
    );
    expect(mapFrame()).toBeNull();
    expect(screen.getByAltText(/Blue Mantis Divers/)).toBeInTheDocument();
  });

  it("draws nothing where no honest query can be built", () => {
    render(
      <TripArrivalCard
        shop={{
          ...shop,
          name: "",
          address: { street: null, locality: null, region: null, postalCode: null, country: null },
        }}
        trip={{ ...trip, meetingPointLabel: null, meetingPointAddress: null }}
        locale="en-US"
        showMap
      />,
    );
    expect(mapFrame()).toBeNull();
  });
});

/**
 * **A rule sits midway between the rows it divides.** The card's column is
 * `gap-3` and each ruled row opened with `pt-4`, so every rule had 12px above
 * it and 16px below, and the rows sat low between their rules (pixel-craft
 * K-480). A ruled row's top padding is the column's gap, whatever it is.
 */
describe("the ruled rows", () => {
  it("pad below each rule exactly what the column keeps above it", () => {
    const { container } = render(
      <TripArrivalCard
        shop={{ ...shop, contactPhone: "+1 305 555 0100" }}
        trip={trip}
        locale="en-US"
        sites={["Molasses Reef"]}
        stopCodeAction={async () => {}}
      />,
    );
    const ruled = [...container.querySelectorAll(".border-t")];

    expect(ruled).toHaveLength(3);
    for (const row of ruled) {
      const gap = row.parentElement?.className.match(/(?:^|\s)gap-(\d+(?:\.\d+)?)(?:\s|$)/)?.[1];
      expect(gap).toBeDefined();
      expect(row).toHaveClass(`pt-${gap}`);
    }
  });

  it("keeps the contact line a text line, its 44px links overhanging it", () => {
    // The links' boxes made "Need a hand?" and its links a 44px line: 22px
    // between the words and the links, 17px under the rule, and 12px more of
    // card below (K-14 review, readiness@390).
    render(
      <TripArrivalCard
        shop={{ ...shop, contactPhone: "+1 305 555 0100", contactEmail: "hello@reef.test" }}
        trip={trip}
        locale="en-US"
      />,
    );
    const phone = screen.getByRole("link", { name: "+1 305 555 0100" });
    expect(phone).toHaveClass("min-h-11");
    // (44 − 20) / 2 above and below, handed back by the links' own row.
    expect(phone.parentElement).toHaveClass("-my-3");
  });
});

/**
 * **The way out of a lost printout** — `stopArrivalCodesFromReady`, issue #1729.
 *
 * The page never shows the code, so the control has to say what it is about on
 * its own, and it may not appear where there is nothing to stop: a diver who
 * never saved the card would be reading a sentence about a credential they do
 * not hold. Whether they hold one is `hasLiveArrivalCapability`'s answer and
 * arrives here as the presence of the action.
 */
describe("stopping the code on a saved card", () => {
  const stop = async () => {};

  it("offers it behind a confirmation that names the consequence", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<TripArrivalCard shop={shop} trip={trip} locale="en-US" stopCodeAction={stop} />);

    // Unarmed, nothing about the printout is claimed yet.
    expect(screen.queryByText(/It will not scan at the counter/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Stop the code on a saved card" }));

    // The consequence is read at the moment of commitment, and it says the
    // *scan* stops — never that the diver's printout was deleted, which would
    // be false about the world.
    expect(
      screen.getByText(
        "Stop the code on any card you saved or printed? It will not scan at the counter; save the card again for a new one.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, stop the code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Never mind" })).toBeInTheDocument();
  });

  it("renders no control at all where there is no code to stop", () => {
    render(<TripArrivalCard shop={shop} trip={trip} locale="en-US" />);
    expect(
      screen.queryByRole("button", { name: "Stop the code on a saved card" }),
    ).not.toBeInTheDocument();
  });
});
