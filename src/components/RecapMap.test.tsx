// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecapMap } from "./RecapMap";

afterEach(() => {
  cleanup();
});

describe("RecapMap", () => {
  it("renders null when there are no sites", () => {
    const { container } = render(<RecapMap sites={[]} />);
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

    render(<RecapMap sites={sites} />);

    expect(screen.getByLabelText(/stylized recap navigation map/i)).toBeInTheDocument();
    expect(screen.getByText("French Reef")).toBeInTheDocument();
    expect(screen.getByText("Molasses Reef")).toBeInTheDocument();
    expect(screen.getByText(/The Dock/)).toBeInTheDocument();
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

    const { container } = render(<RecapMap sites={sites} />);

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
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
