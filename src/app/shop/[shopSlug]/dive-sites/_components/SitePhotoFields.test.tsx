// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { removablePhotoGridClass } from "@/components/RemovablePhoto";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import type { TideStationEcho } from "@/lib/tide-stations";
import type { SiteFieldValues } from "./SiteFields";
import { SitePhotoFields } from "./SitePhotoFields";
import { STORED } from "./site-fields-test-fixtures";

afterEach(cleanup);

const t = staffTranslator("en-US");

function renderFields(
  _tideStation?: TideStationEcho | null,
  _depthUnit: DepthUnit = "meters",
  locale: "en-US" | "es-ES" = "en-US",
  values?: SiteFieldValues,
  /** The edit page's caption over the specialty boxes; the new-site form passes none. */
  _requiredSpecialtiesLabel?: string,
) {
  const translator = locale === "en-US" ? t : staffTranslator(locale);
  render(
    <SitePhotoFields t={translator} values={values} />,
    // Inside a form, as both pages render it, so a test can read what the
    // form would submit.
    { container: document.body.appendChild(document.createElement("form")) },
  );
}

/**
 * The site's stored photos are taken off the way the course editor's are —
 * one `RemovablePhoto`, with the tick this form's hand-drawn copy had left
 * behind and a ring on the photo when its hidden box has focus.
 */
describe("SitePhotoFields — a stored photo", () => {
  const WITH_PHOTOS: SiteFieldValues = {
    ...STORED,
    satelliteImageUrl: "/dive-sites/molasses-map.jpg",
    routeImageUrl: "/dive-sites/molasses-route.jpg",
    imageUrls: ["/dive-sites/molasses-1.jpg", "/dive-sites/molasses-2.jpg"],
  };

  it("draws every stored photo as the shared removable photo", () => {
    renderFields(null, "meters", "en-US", WITH_PHOTOS);

    const boxes = [
      ...document.querySelectorAll<HTMLInputElement>(
        'input[name="removeSatelliteImage"], input[name="removeRouteImage"], input[name="removeSiteImageUrls"]',
      ),
    ];
    expect(boxes).toHaveLength(4);
    for (const box of boxes) {
      expect(box.nextElementSibling).toHaveClass("peer-focus-visible:focus-ring", "border-2");
      expect(box.nextElementSibling?.nextElementSibling).toHaveAttribute("aria-hidden", "true");
    }
  });

  /**
   * The full-width field's photos are the gallery's cells; a half column's
   * lone still takes its column. In the gallery's three-across grid a half
   * column's photo is a third of a half — about 83px wide at 640 — which is
   * how the trip's arrival photo shrank.
   */
  it("sets the site's photos in the gallery grid, and lets a half column's still take the column", () => {
    renderFields(null, "meters", "en-US", WITH_PHOTOS);
    const holder = (name: string) =>
      document.querySelector(`input[name="${name}"]`)?.closest("label")?.parentElement;

    expect(holder("removeSiteImageUrls")).toHaveClass(...removablePhotoGridClass.split(" "));
    for (const still of ["removeSatelliteImage", "removeRouteImage"]) {
      expect(holder(still)?.className).not.toMatch(/(^|\s)grid(\s|$)|grid-cols/);
    }
  });
});
