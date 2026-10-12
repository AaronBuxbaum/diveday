// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import type { TideStationEcho } from "@/lib/tide-stations";
import { routeEditorCopy } from "./route-editor-copy";
import { SiteFields, type SiteFieldValues } from "./SiteFields";
import { fieldGuideEditorCopy, landmarkEditorCopy } from "./site-editor-copy";
import { FAR } from "./site-fields-test-fixtures";

afterEach(cleanup);

const t = staffTranslator("en-US");

function renderFields(
  tideStation?: TideStationEcho | null,
  depthUnit: DepthUnit = "meters",
  locale: "en-US" | "es-ES" = "en-US",
  values?: SiteFieldValues,
  /** The edit page's caption over the specialty boxes; the new-site form passes none. */
  requiredSpecialtiesLabel?: string,
) {
  const translator = locale === "en-US" ? t : staffTranslator(locale);
  render(
    <SiteFields
      t={translator}
      depthUnit={depthUnit}
      tideStation={tideStation}
      values={values}
      certificationDescription="Who can dive this site."
      requiredSpecialtiesLabel={requiredSpecialtiesLabel}
      routeCopy={routeEditorCopy(translator)}
      landmarkCopy={landmarkEditorCopy(translator)}
      fieldGuideCopy={fieldGuideEditorCopy(translator)}
      marineLifeCatalog={[]}
      locale={locale}
      timezone="America/New_York"
    />,
    // Inside a form, as both pages render it, so a test can read what the
    // form would submit.
    { container: document.body.appendChild(document.createElement("form")) },
  );
}

/**
 * **A helper sentence is a description under its control, never a hint on its
 * caption** (docs/design/pixel-craft.md, class 12; K-418). `Field`'s `hint` is
 * the inline "(optional)" qualifier, 14px on the caption's own line; the NOAA
 * station's two sentences and link, and the conservation note's sentence, rode
 * there, so the form drew help two ways — 14px after a label, or 12px under a
 * control — and "NOAA tide station" stood two lines above "Dives best" beside
 * it. The maximum depth, the time in the water and the tips heading carried a
 * sentence inside their "(optional · …)", which wrapped into a two-line
 * parenthetical after the label. A description is also what a screen reader
 * hears as the box's description rather than as part of its name.
 */
describe("SiteFields — help under the control (K-418)", () => {
  const describedBy = (control: Element | null) =>
    document.getElementById(control?.getAttribute("aria-describedby") ?? "");

  it("puts the NOAA station's help under the box, with its link", () => {
    renderFields(null);
    const input = document.querySelector('input[name="tideStationId"]') as HTMLInputElement;
    const caption = input.labels?.[0];
    expect(caption?.textContent).toBe("NOAA tide station");
    expect(caption?.querySelector("a")).toBeNull();
    const help = describedBy(input);
    expect(help?.textContent).toContain("The list covers US waters only.");
    expect(help?.querySelector("a")).toHaveAttribute(
      "href",
      "https://tidesandcurrents.noaa.gov/tide_predictions.html",
    );
  });

  it("keeps the station NOAA answered for under the help, in the same description", () => {
    renderFields(FAR);
    const help = describedBy(document.querySelector('input[name="tideStationId"]'));
    expect(help?.textContent).toContain("The list covers US waters only.");
    expect(help?.textContent).toContain("8723970 · Vaca Key, FL");
  });

  it("puts the conservation note's sentence under its box", () => {
    renderFields(null);
    const box = document.querySelector('textarea[name="conservationNote"]') as HTMLTextAreaElement;
    expect(box.labels?.[0]?.textContent).toBe("Conservation note");
    expect(describedBy(box)?.textContent).toBe(t("diveSites.form.conservationNoteHint"));
  });

  it("keeps only (optional) on a caption, and its sentence under the box", () => {
    renderFields(null);
    const fields = [
      ["maxDepth", "diveSites.form.maxDepthMetersLabel", "diveSites.form.maxDepthHint"],
      [
        "expectedBottomTime",
        "diveSites.form.expectedBottomTimeLabel",
        "diveSites.form.expectedBottomTimeHint",
      ],
      [
        "fieldGuideTipsHeading",
        "diveSites.form.tipsHeadingLabel",
        "diveSites.form.tipsHeadingHint",
      ],
    ] as const;
    for (const [name, label, sentence] of fields) {
      const box = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      expect(box.labels?.[0]?.textContent).toBe(`${t(label)} ${t("diveSites.form.optionalHint")}`);
      expect(describedBy(box)?.textContent).toBe(t(sentence));
      expect(t(sentence)).not.toMatch(/^\(|\)$/);
    }
  });
});
