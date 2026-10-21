// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import SiteMap, { type MapPin } from "./SiteMap";

beforeAll(async () => {
  await import("leaflet");
});
afterEach(cleanup);

const CENTER = { latitude: 25.01, longitude: -80.37 };
const PIN: MapPin = {
  id: "reef",
  name: "Molasses & French Reef",
  subtitle: "Outer bank",
  href: "/shop/blue-mantis/dive-sites/reef?tab=details&from=map",
  hrefLabel: "Open site",
  ...CENTER,
};

async function markerButton(container: HTMLElement) {
  await waitFor(() =>
    expect(container.querySelector(".leaflet-site-marker button")).not.toBeNull(),
  );
  const button = container.querySelector(".leaflet-site-marker button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Site marker did not mount");
  return button;
}

function popup(container: HTMLElement) {
  const content = container.querySelector(".leaflet-popup-content");
  if (!(content instanceof HTMLElement)) throw new Error("Popup did not open");
  return content;
}

describe("SiteMap labels through Leaflet", () => {
  it("gives each marker one named native button without an interactive wrapper", async () => {
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[PIN]}
        shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
        clusterLabel="dive sites"
      />,
    );
    const siteButton = await markerButton(container);
    const shopMarker = container.querySelector(".leaflet-shop-marker");
    const siteMarker = container.querySelector(".leaflet-site-marker");
    expect(siteButton).toHaveAccessibleName(PIN.name);
    for (const marker of [siteMarker, shopMarker]) {
      expect(marker).not.toHaveAttribute("role", "button");
      expect(marker).not.toHaveAttribute("tabindex");
      expect(marker?.querySelectorAll("button")).toHaveLength(1);
    }
    expect(shopMarker?.querySelector("button")).toHaveAccessibleName("Blue Mantis");
  });

  it("opens the shop popup once for the native Enter activation sequence", async () => {
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[]}
        shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".leaflet-shop-marker button")).not.toBeNull(),
    );
    const button = container.querySelector(".leaflet-shop-marker button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Shop button did not mount");
    fireEvent.keyPress(button, { key: "Enter", keyCode: 13, charCode: 13 });
    fireEvent.click(button);
    expect(popup(container).querySelector("strong")?.textContent).toBe("Blue Mantis");
  });

  it("keeps a hostile-shaped site name inside its marker label", async () => {
    const name = '"><img src=x onerror="alert(1)"><span data-injected="yes">';
    const { container } = render(
      <SiteMap center={CENTER} pins={[{ ...PIN, name }]} clusterLabel="dive sites" />,
    );
    const button = await markerButton(container);
    expect(button).toHaveAttribute("aria-label", name);
    expect(container.querySelector("[data-injected], img[onerror]")).toBeNull();
  });

  it("renders site names and subtitles literally in the popup", async () => {
    const name = '<img src=x onerror="alert(1)"> Reef & <b>Friends</b>';
    const subtitle = '<svg onload="alert(2)"></svg> <a href="javascript:alert(3)">Bank</a>'; // diveday:allow-scroll-preservation: hostile test input.
    const { container } = render(
      <SiteMap center={CENTER} pins={[{ ...PIN, name, subtitle }]} clusterLabel="dive sites" />,
    );
    fireEvent.click(await markerButton(container));
    const content = popup(container);
    expect(content.querySelector("h2")?.textContent).toBe(name);
    expect(content.querySelector("p")?.textContent).toBe(subtitle);
    expect(content.querySelector("img, svg, b, [onerror], [onload]")).toBeNull();
    expect(content.querySelectorAll("a")).toHaveLength(1);
  });

  it.each(["name", "fallback"])("renders the shop %s literally", async (source) => {
    const label = '<img src=x onerror="alert(1)"> Blue & <b>Mantis</b>';
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[]}
        shopAnchor={{ ...CENTER, name: source === "name" ? label : undefined }}
        shopLabel={label}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() => expect(container.querySelector(".leaflet-shop-marker")).not.toBeNull());
    const anchor = container.querySelector(".leaflet-shop-marker");
    if (!anchor) throw new Error("Shop marker did not mount");
    const button = anchor.querySelector("button");
    if (!button) throw new Error("Shop button did not mount");
    expect(button).toHaveAttribute("aria-label", label);
    fireEvent.click(button);
    const content = popup(container);
    expect(content.querySelector("strong")?.textContent).toBe(label);
    expect(content.querySelector("img, b, [onerror]")).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " \tjava\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ])("omits an unsafe details link: %s", async (href) => {
    const { container } = render(
      <SiteMap center={CENTER} pins={[{ ...PIN, href }]} clusterLabel="dive sites" />,
    );
    fireEvent.click(await markerButton(container));
    const content = popup(container);
    expect(content.querySelector("h2")?.textContent).toBe(PIN.name);
    expect(content.querySelector("a")).toBeNull();
  });

  it.each([
    PIN.href,
    "https://example.com/reef?q=a&b=c",
    "http://example.com/reef",
    '/reef?name=" onclick="alert(1)',
  ])("preserves a normal details link and map selection: %s", async (href) => {
    const onSelectPin = vi.fn();
    const { container, rerender } = render(
      <SiteMap
        center={CENTER}
        pins={[{ ...PIN, href }]}
        onSelectPin={onSelectPin}
        clusterLabel="dive sites"
      />,
    );
    const button = await markerButton(container);
    expect(button).toHaveAttribute("aria-label", PIN.name);
    fireEvent.keyPress(button, { key: "Enter", keyCode: 13, charCode: 13 });
    fireEvent.click(button);
    expect(onSelectPin).toHaveBeenCalledTimes(1);
    expect(onSelectPin).toHaveBeenCalledWith(PIN.id);
    const link = popup(container).querySelector("a");
    expect(link).toHaveAttribute("href", href ?? "");
    expect(link).toHaveTextContent("Open site →");
    expect(link).not.toHaveAttribute("onclick");
    rerender(
      <SiteMap
        center={CENTER}
        pins={[{ ...PIN, href }]}
        selectedPinId={PIN.id}
        onSelectPin={onSelectPin}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-marker button")).toHaveClass("ring-4"),
    );
    expect(popup(container).querySelector("h2")?.textContent).toBe(PIN.name);
    await waitFor(() => expect(container.querySelectorAll(".leaflet-site-popup")).toHaveLength(1));
  });

  it("shows the site name and location on hover", async () => {
    const { container } = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" />,
    );
    fireEvent.mouseOver(await markerButton(container));
    await waitFor(() => {
      expect(container.querySelector(".leaflet-tooltip")?.textContent).toContain(PIN.name);
      expect(container.querySelector(".leaflet-tooltip")?.textContent).toContain(PIN.subtitle);
    });
  });
});
