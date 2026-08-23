// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DiveSiteFormError, submittedValues } from "@/lib/dive-sites";
import { type SiteFormAction, SiteFormShell } from "./SiteFormShell";

afterEach(cleanup);

/** The sentences the page resolves from the staff bundle before rendering. */
const MESSAGES: Record<DiveSiteFormError, string> = {
  invalid: "That didn't save. Check the required name and links, then try again.",
  coordinatesIncomplete: "Add both forecast coordinates, or leave both blank.",
  depthTooDeep: "That maximum depth is deeper than any dive site.",
  images: "One of those image links couldn't be used.",
  imagesUnconfigured: "Image hosting isn't set up for this shop yet.",
  conflict: "Somebody else changed this briefing while you had it open.",
  nameTaken: "Another dive site here already goes by that name.",
};

/** Stands in for the server action: refuses, and hands the submission back. */
function refusing(errorCode: DiveSiteFormError) {
  return vi.fn<SiteFormAction>(async (_state, formData) => ({
    errorCode,
    values: submittedValues(formData),
  }));
}

function setup(action: SiteFormAction) {
  render(
    <SiteFormShell action={action} errorMessages={MESSAGES}>
      <label htmlFor="name">Name</label>
      <input id="name" name="name" defaultValue="" />
      <label htmlFor="lat">Latitude</label>
      <input id="lat" name="forecastLatitude" defaultValue="" />
      <label htmlFor="lng">Longitude</label>
      <input id="lng" name="forecastLongitude" defaultValue="" />
      <label htmlFor="plan">Dive plan</label>
      <textarea id="plan" name="divePlan" defaultValue="" />
      <label htmlFor="cert">Minimum certification</label>
      <select id="cert" name="minimumCertificationLevel" defaultValue="">
        <option value="">None</option>
        <option value="rescue">Rescue</option>
      </select>
      <label htmlFor="wreck">Wreck</label>
      <input id="wreck" type="checkbox" name="specialty" value="wreck" />
      <label htmlFor="night">Night</label>
      <input id="night" type="checkbox" name="specialty" value="night" />
      <label htmlFor="nitrox">Nitrox</label>
      <input id="nitrox" type="checkbox" name="requiresNitrox" defaultChecked />
      <button type="submit">Save dive site</button>
    </SiteFormShell>,
  );
}

describe("SiteFormShell", () => {
  it("keeps every entered value and names the rule that refused the save", async () => {
    // The regression (R4): a refused briefing used to redirect back to a blank
    // form, so a staffer who mistyped one coordinate lost the other nineteen
    // fields — and the banner they got named the name and the links, neither
    // of which had failed. Staying on the page is only half the fix: React
    // empties an uncontrolled form the moment its action settles, so this also
    // pins that the submitted values come back onto the controls.
    const action = refusing("coordinatesIncomplete");
    setup(action);

    await userEvent.type(screen.getByLabelText("Name"), "Turtle Garden");
    await userEvent.type(screen.getByLabelText("Latitude"), "25.123");
    await userEvent.type(screen.getByLabelText("Dive plan"), "Drop on the sand, swim the ledge.");
    await userEvent.selectOptions(screen.getByLabelText("Minimum certification"), "rescue");
    await userEvent.click(screen.getByLabelText("Wreck"));
    await userEvent.click(screen.getByLabelText("Nitrox")); // unticks the default
    await userEvent.click(screen.getByRole("button", { name: "Save dive site" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add both forecast coordinates, or leave both blank.",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Turtle Garden");
    expect(screen.getByLabelText("Latitude")).toHaveValue("25.123");
    expect(screen.getByLabelText("Longitude")).toHaveValue("");
    expect(screen.getByLabelText("Dive plan")).toHaveValue("Drop on the sand, swim the ledge.");
    expect(screen.getByLabelText("Minimum certification")).toHaveValue("rescue");
    expect(screen.getByLabelText("Wreck")).toBeChecked();
    expect(screen.getByLabelText("Night")).not.toBeChecked();
    // A box that was cleared has to come back cleared, not back to its default.
    expect(screen.getByLabelText("Nitrox")).not.toBeChecked();
    expect(action).toHaveBeenCalledOnce();
  });

  it("shows no banner before anything is submitted", () => {
    setup(refusing("invalid"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("words each refusal from its own code", async () => {
    setup(refusing("depthTooDeep"));

    await userEvent.click(screen.getByRole("button", { name: "Save dive site" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That maximum depth is deeper than any dive site.",
    );
  });

  it("puts the refusal inside the form, beside the button that was pressed", async () => {
    // It used to render above the form — on a twenty-field briefing, a full
    // screen above the Save button the staffer had just pressed, so the save
    // looked like it had simply done nothing.
    setup(refusing("invalid"));
    const button = screen.getByRole("button", { name: "Save dive site" });

    await userEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(button.closest("form")?.contains(alert)).toBe(true);
    // And after the button, not before the first field.
    expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves the cursor to the refusal", async () => {
    setup(refusing("coordinatesIncomplete"));

    await userEvent.click(screen.getByRole("button", { name: "Save dive site" }));

    const alert = await screen.findByRole("alert");
    expect(document.activeElement?.contains(alert)).toBe(true);
  });
});
