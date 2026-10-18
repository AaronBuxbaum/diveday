// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { Requirement } from "@/lib/requirement";
import { RequirementFields } from "./RequirementFields";

afterEach(cleanup);

const t = staffTranslator("en-US");

const STORED: Requirement = {
  minimumCertificationLevel: null,
  requiredSpecialties: [],
  requiresNitrox: false,
};

function renderFields(
  values?: Requirement,
  /** The edit page's caption over the specialty boxes; the new-site form passes none. */
  legend?: string,
) {
  render(
    <RequirementFields
      t={t}
      requirement={values}
      defaultLevel=""
      labels={{ level: "Level", noLevel: "None", nitrox: "Nitrox" }}
      legend={legend}
    />,
    // Inside a form, as both pages render it, so a test can read what the
    // form would submit.
    { container: document.body.appendChild(document.createElement("form")) },
  );
}

/**
 * **The specialty boxes are captioned as a group, a field caption's distance
 * from them** (docs/design/pixel-craft.md, class 4; K-212). The edit form's
 * "Required specialties" was a bare paragraph over a grid pushed `mt-3` down,
 * and the new-site form, which has no caption, kept the `mt-3` with nothing
 * above it: 32px from the level select to the first row where the section's
 * fields stand 20px apart.
 *
 * A site's requirements decide who may book it, so the boxes, their names and
 * what they hold are pinned here too: only where they sit moved.
 */
describe("RequirementFields — the required specialties (K-212)", () => {
  const specialtyBoxes = (scope: ParentNode = document) =>
    [...scope.querySelectorAll('input[type="checkbox"][name="specialty"]')] as HTMLInputElement[];

  it("captions the edit form's boxes as one group, its legend over them", () => {
    renderFields(STORED, "Required specialties");
    const group = screen.getByRole("group", { name: "Required specialties" });
    expect(group.tagName).toBe("FIELDSET");
    expect(specialtyBoxes(group).map((box) => box.value)).toEqual([
      "deep",
      "wreck",
      "night",
      "drysuit",
      "cavern",
    ]);
    expect(group.querySelector('input[name="requiresNitrox"]')).not.toBeNull();
    const grid = specialtyBoxes(group)[0].closest("label")?.parentElement;
    expect(grid?.className).not.toMatch(/(^|\s)mt-3(\s|$)/);
    expect(screen.queryByText("Required specialties", { selector: "p" })).toBeNull();
  });

  it("starts the new form's uncaptioned boxes at the section's own gap", () => {
    renderFields();
    const grid = specialtyBoxes()[0].closest("label")?.parentElement;
    expect(grid?.className).not.toMatch(/(^|\s)m[ty]-\d/);
    expect(screen.queryByRole("group", { name: "Required specialties" })).toBeNull();
  });

  it("keeps what a stored site requires ticked, and nothing else", () => {
    renderFields(
      { ...STORED, requiredSpecialties: ["deep", "night"], requiresNitrox: true },
      "Required specialties",
    );
    expect(
      specialtyBoxes()
        .filter((box) => box.checked)
        .map((box) => box.value),
    ).toEqual(["deep", "night"]);
    expect(document.querySelector('input[name="requiresNitrox"]')).toBeChecked();
    cleanup();
    renderFields(STORED, "Required specialties");
    expect(specialtyBoxes().some((box) => box.checked)).toBe(false);
    expect(document.querySelector('input[name="requiresNitrox"]')).not.toBeChecked();
  });

  it("submits what is ticked under the names both actions read, captioned or not", () => {
    for (const caption of [undefined, "Required specialties"]) {
      renderFields(
        { ...STORED, requiredSpecialties: ["deep", "drysuit"], requiresNitrox: true },
        caption,
      );
      const form = specialtyBoxes()[0].form;
      expect(form).not.toBeNull();
      const submitted = new FormData(form as HTMLFormElement);
      expect(submitted.getAll("specialty")).toEqual(["deep", "drysuit"]);
      expect(submitted.get("requiresNitrox")).toBe("on");
      cleanup();
    }
  });
});
