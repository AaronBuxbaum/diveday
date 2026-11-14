// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapPin } from "@/components/map/SiteMap";
import { CatalogMapLayout } from "./CatalogMapLayout";
import { SiteLibraryLayout } from "./SiteLibraryLayout";

vi.mock("@/components/map/LazySiteMap", () => ({
  LazySiteMap: ({
    onSelectPin,
    selectedPinId,
  }: {
    onSelectPin?: (id: string | null) => void;
    selectedPinId?: string | null;
  }) => (
    <div>
      <button type="button" onClick={() => onSelectPin?.("reef-1")}>
        Select map pin
      </button>
      <output data-testid="selected-pin">{selectedPinId}</output>
    </div>
  ),
}));

vi.mock("./QuietSiteMap", () => ({
  QuietSiteMap: ({
    onSelectPin,
    selectedPinId,
  }: {
    onSelectPin?: (id: string | null) => void;
    selectedPinId?: string | null;
  }) => (
    <div>
      <button type="button" onClick={() => onSelectPin?.("reef-1")}>
        Select map pin
      </button>
      <output data-testid="selected-pin">{selectedPinId}</output>
    </div>
  ),
}));

let restoreScrollSpy: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restoreScrollSpy?.();
  restoreScrollSpy = null;
});

const pins: MapPin[] = [{ id: "reef-1", name: "North Reef", latitude: 25, longitude: -80 }];

function installScrollSpy() {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });

  const restore = () => {
    if (descriptor) {
      Object.defineProperty(Element.prototype, "scrollIntoView", descriptor);
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
    restoreScrollSpy = null;
  };
  restoreScrollSpy = restore;

  return {
    scrollIntoView,
    restore,
  };
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const FOLLOW = {
  followLabel: "Filter by map",
  areaCount: "12 sites",
  scoped: false,
  baseHref: "/shop/blue-mantis/dive-sites",
};

describe("dive-site map layouts", () => {
  it("places the map before the library rows", () => {
    render(
      <SiteLibraryLayout
        {...FOLLOW}
        shopAnchor={null}
        pins={pins}
        clusterLabel="dive sites"
        zoomHint="Use ⌘ or Ctrl + scroll to zoom"
      >
        <div>Library rows</div>
      </SiteLibraryLayout>,
    );
    expect(
      screen
        .getByRole("button", { name: "Select map pin" })
        .compareDocumentPosition(screen.getByText("Library rows")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("selects a library pin without scrolling the page to its ledger row", () => {
    const scrollSpy = installScrollSpy();
    render(
      <SiteLibraryLayout
        {...FOLLOW}
        shopAnchor={null}
        pins={pins}
        clusterLabel="dive sites"
        zoomHint="Use ⌘ or Ctrl + scroll to zoom"
      >
        <div id="site-row-reef-1">North Reef row</div>
      </SiteLibraryLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select map pin" }));

    expect(screen.getByTestId("selected-pin").textContent).toBe("reef-1");
    expect(scrollSpy.scrollIntoView).not.toHaveBeenCalled();
    scrollSpy.restore();
  });

  it("selects a catalog pin without scrolling the page to its ledger row", () => {
    const scrollSpy = installScrollSpy();
    render(
      <CatalogMapLayout
        {...FOLLOW}
        shopAnchor={null}
        pins={pins.map((pin) => ({ ...pin, slug: "north-reef" }))}
        catalogPageHref="/shop/demo/dive-sites?view=catalog"
        openSiteLabel="Open site"
        loadDetails={async () => null}
        detailWords={{ loading: "Loading", unavailable: "Unavailable" }}
        clusterLabel="dive sites"
        zoomHint="Use ⌘ or Ctrl + scroll to zoom"
      >
        <div id="template-row-reef-1">North Reef row</div>
      </CatalogMapLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select map pin" }));

    expect(screen.getByTestId("selected-pin").textContent).toBe("reef-1");
    expect(scrollSpy.scrollIntoView).not.toHaveBeenCalled();
    scrollSpy.restore();
  });

  it.each([
    [
      "library",
      () => (
        <SiteLibraryLayout
          {...FOLLOW}
          shopAnchor={null}
          pins={pins}
          clusterLabel="dive sites"
          zoomHint="Use ⌘ or Ctrl + scroll to zoom"
        >
          <div>Rows</div>
        </SiteLibraryLayout>
      ),
    ],
    [
      "catalog",
      () => (
        <CatalogMapLayout
          {...FOLLOW}
          shopAnchor={null}
          pins={pins.map((pin) => ({ ...pin, slug: "north-reef" }))}
          catalogPageHref="/shop/demo/dive-sites?view=catalog"
          openSiteLabel="Open site"
          loadDetails={async () => null}
          detailWords={{ loading: "Loading", unavailable: "Unavailable" }}
          clusterLabel="dive sites"
          zoomHint="Use ⌘ or Ctrl + scroll to zoom"
        >
          <div>Rows</div>
        </CatalogMapLayout>
      ),
    ],
  ])("draws Filter by map on the %s map, not under it", (_view, layout) => {
    render(layout());
    const map = screen.getByRole("button", { name: "Select map pin" }).parentElement?.parentElement;
    expect(map?.contains(screen.getByRole("switch", { name: /Filter by map/ }))).toBe(true);
  });
});
