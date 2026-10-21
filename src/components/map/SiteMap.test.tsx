// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteMap, { type MapPin } from "./SiteMap";

afterEach(cleanup);

const CENTER = { latitude: 25.01, longitude: -80.37 };
const PIN: MapPin = {
  id: "reef",
  name: "Molasses & French Reef",
  subtitle: "Outer bank",
  href: "/shop/blue-mantis/dive-sites/reef?tab=details&from=map",
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
  it("keeps a hostile-shaped site name inside its marker label", async () => {
    const name = '"><img src=x onerror="alert(1)"><span data-injected="yes">';
    const { container } = render(<SiteMap center={CENTER} pins={[{ ...PIN, name }]} />);
    const button = await markerButton(container);
    expect(button).toHaveAttribute("aria-label", name);
    expect(container.querySelector("[data-injected], img[onerror]")).toBeNull();
  });

  it("renders site names and subtitles literally in the popup", async () => {
    const name = '<img src=x onerror="alert(1)"> Reef & <b>Friends</b>';
    const subtitle = '<svg onload="alert(2)"></svg> <a href="javascript:alert(3)">Bank</a>'; // diveday:allow-scroll-preservation: hostile test input.
    const { container } = render(<SiteMap center={CENTER} pins={[{ ...PIN, name, subtitle }]} />);
    fireEvent.click(await markerButton(container));
    const content = popup(container);
    expect(content.querySelector("p")?.textContent).toBe(name);
    expect(content.querySelectorAll("p")[1]?.textContent).toBe(subtitle);
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
      />,
    );
    await waitFor(() => expect(container.querySelector(".leaflet-shop-marker")).not.toBeNull());
    const anchor = container.querySelector(".leaflet-shop-marker");
    if (!anchor) throw new Error("Shop marker did not mount");
    fireEvent.click(anchor);
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
    const { container } = render(<SiteMap center={CENTER} pins={[{ ...PIN, href }]} />);
    fireEvent.click(await markerButton(container));
    const content = popup(container);
    expect(content.querySelector("p")?.textContent).toBe(PIN.name);
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
      <SiteMap center={CENTER} pins={[{ ...PIN, href }]} onSelectPin={onSelectPin} />,
    );
    const button = await markerButton(container);
    expect(button).toHaveAttribute("aria-label", PIN.name);
    fireEvent.click(button);
    expect(onSelectPin).toHaveBeenCalledWith(PIN.id);
    const link = popup(container).querySelector("a");
    expect(link).toHaveAttribute("href", href ?? "");
    expect(link).toHaveTextContent("View details →");
    expect(link).not.toHaveAttribute("onclick");
    rerender(
      <SiteMap
        center={CENTER}
        pins={[{ ...PIN, href }]}
        selectedPinId={PIN.id}
        onSelectPin={onSelectPin}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-marker button")).toHaveClass("ring-4"),
    );
    expect(popup(container).querySelector("p")?.textContent).toBe(PIN.name);
  });
});
