// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecapMap } from "./RecapMap";

afterEach(() => {
  cleanup();
});

const copy = {
  mapAriaLabel: "Stylized recap navigation map of your dive sites",
  charterPath: "CHARTER PATH",
  boatTrack: "Boat Track",
  theDock: "The Dock",
  reconstructedPath: "📍 Reconstructed boat path visiting 2 dive sites",
};

describe("RecapMap", () => {
  it("renders null when there are no sites", () => {
    const { container } = render(<RecapMap sites={[]} copy={copy} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the SVG map and site names when sites are provided", () => {
    const sites = [
      {
        name: "French Reef",
        locationName: "Key Largo",
        marineLife: "Moray eels",
        forecastLatitude: 25.12,
        forecastLongitude: -80.38,
      },
      {
        name: "Molasses Reef",
        locationName: "Key Largo",
        marineLife: "Turtles",
        forecastLatitude: 25.01,
        forecastLongitude: -80.45,
      },
    ];

    render(<RecapMap sites={sites} copy={copy} />);

    expect(screen.getByLabelText(/stylized recap navigation map/i)).toBeInTheDocument();
    expect(screen.getByText("French Reef")).toBeInTheDocument();
    expect(screen.getByText("Molasses Reef")).toBeInTheDocument();
    expect(screen.getByText(/The Dock/)).toBeInTheDocument();
  });

  it("keeps a single site and the dock inside the plotted map", () => {
    render(
      <RecapMap
        sites={[
          {
            name: "Solo Reef",
            locationName: "Key Largo",
            marineLife: "Turtles",
            forecastLatitude: 25.12,
            forecastLongitude: -80.38,
          },
        ]}
        copy={copy}
      />,
    );

    const route = screen
      .getByLabelText(/stylized recap navigation map/i)
      .querySelector("path[d^='M']");
    expect(route).not.toBeNull();
    expect(route?.getAttribute("d")).not.toMatch(/-\d/);
  });

  it("omits the map when coordinates are missing", () => {
    const sites = [
      {
        name: "Mystery Reef",
        locationName: null,
        marineLife: null,
        forecastLatitude: null,
        forecastLongitude: null,
      },
    ];

    const { container } = render(<RecapMap sites={sites} copy={copy} />);

    expect(container.firstChild).toBeNull();
  });

  it("omits the map when only some sites have coordinates", () => {
    const { container } = render(
      <RecapMap
        sites={[
          {
            name: "Known Reef",
            locationName: null,
            marineLife: null,
            forecastLatitude: 25.12,
            forecastLongitude: -80.38,
          },
          {
            name: "Unmapped Reef",
            locationName: null,
            marineLife: null,
            forecastLatitude: null,
            forecastLongitude: -80.4,
          },
        ]}
        copy={copy}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
