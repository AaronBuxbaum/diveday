// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import SiteMap, { type MapPin } from "./SiteMap";

beforeAll(async () => {
  await import("leaflet");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CENTER = { latitude: 25.01, longitude: -80.37 };
const PIN: MapPin = {
  id: "reef",
  name: "Molasses & French Reef",
  href: "/shop/blue-mantis/dive-sites/reef",
  hrefLabel: "Open site",
  ...CENTER,
};

async function markerButton(container: HTMLElement) {
  await waitFor(() =>
    expect(container.querySelector(".leaflet-site-marker button")).not.toBeNull(),
  );
}

function popup(container: HTMLElement) {
  const content = container.querySelector(".leaflet-popup-content");
  if (!(content instanceof HTMLElement)) throw new Error("Popup did not open");
  return content;
}

describe("SiteMap viewport changes", () => {
  it("updates visible sites when zooming out without closing the selected site", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 640 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 440 : 0;
    });
    const onSelect = vi.fn();
    const neighbor = { ...PIN, id: "neighbor", name: "Neighbor", longitude: PIN.longitude + 0.5 };
    const { container, getByRole, queryByRole } = render(
      <SiteMap
        center={CENTER}
        pins={[PIN, neighbor]}
        onSelectPin={onSelect}
        clusterLabel="dive sites"
      />,
    );
    await markerButton(container);
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Leaflet map did not mount");
    await act(async () => map.setView([CENTER.latitude, CENTER.longitude], 12, { animate: false }));
    expect(queryByRole("button", { name: neighbor.name })).toBeNull();
    fireEvent.click(getByRole("button", { name: PIN.name }));
    const card = popup(container);
    const link = getByRole("link", { name: PIN.hrefLabel });
    link.focus();
    await act(async () => map.setZoom(9, { animate: false }));
    await waitFor(() => expect(getByRole("button", { name: neighbor.name })).toBeInTheDocument());
    expect(popup(container)).toBe(card);
    expect(link).toHaveFocus();
    expect(onSelect).toHaveBeenLastCalledWith(PIN.id);
    expect(onSelect).not.toHaveBeenCalledWith(null);

    fireEvent.click(getByRole("button", { name: neighbor.name }));
    expect(popup(container)).toHaveTextContent(neighbor.name);
    expect(onSelect).toHaveBeenLastCalledWith(neighbor.id);
    fireEvent.click(getByRole("button", { name: "Close popup" }));
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(null));
  });
});
