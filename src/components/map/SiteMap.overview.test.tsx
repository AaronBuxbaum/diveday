// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteMap, { type MapPin } from "./SiteMap";

const CENTER = { latitude: 25.01, longitude: -80.37 };
const PIN: MapPin = { id: "reef", name: "Reef", ...CENTER };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SiteMap overview", () => {
  it("fits nearby sites as closely as the map permits", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(440);
    const pins = [PIN, { ...PIN, id: "nearby", longitude: PIN.longitude + 0.01 }];
    const { container } = render(<SiteMap center={CENTER} pins={pins} clusterLabel="dive sites" />);
    await waitFor(() => expect(container.querySelector(".leaflet-container")).not.toBeNull());
    await waitFor(() => {
      const map = getContainer.mock.contexts[0];
      if (!(map instanceof L.Map)) throw new Error("Map did not mount");
      expect(map.getZoom()).toBeGreaterThan(11);
      for (const pin of pins)
        expect(map.getBounds().contains([pin.latitude, pin.longitude])).toBe(true);
    });
  });
});
