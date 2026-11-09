// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SiteMap, { type MapPin } from "./SiteMap";

const CENTER = { latitude: 25.01, longitude: -80.37 };
const PIN: MapPin = {
  id: "reef",
  name: "Reef",
  href: "/shop/blue-mantis/dive-sites/reef",
  hrefLabel: "Open site",
  ...CENTER,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("loads catalog details on selection rather than creating every marker", async () => {
  const load = vi.fn(async () => ({ description: "Selected briefing", details: ["18 m"] }));
  const { container } = render(
    <SiteMap
      center={CENTER}
      pins={[PIN]}
      clusterLabel="dive sites"
      loadPinDetails={load}
      pinDetailsWords={{ loading: "Loading", unavailable: "Unavailable" }}
    />,
  );
  await waitFor(() =>
    expect(container.querySelector(".leaflet-site-marker button")).not.toBeNull(),
  );
  const button = container.querySelector(".leaflet-site-marker button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Site marker did not mount");
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(container.textContent).toContain("Selected briefing"));
  expect(load).toHaveBeenCalledExactlyOnceWith(PIN.id);
  expect(container.querySelector(".leaflet-site-card__body")?.getAttribute("aria-busy")).toBe(
    "false",
  );
  expect(container.querySelector(".leaflet-site-card__link")?.getAttribute("href")).toBe(PIN.href);
});
