// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { CourseSwitches } from "./CourseSwitches";

const t = staffTranslator("en-US");
const CATALOG = ["bcd", "regulator", "wetsuit", "mask", "fins", "weights", "gopro", "nitrox"];

afterEach(cleanup);

function kindBoxes() {
  const group = screen.getByTestId("course-included-kinds");
  return within(group)
    .getAllByRole("checkbox")
    .map((box) => ({
      kind: (box as HTMLInputElement).value,
      ticked: (box as HTMLInputElement).checked,
    }));
}

/** **What the course fee includes** (issue #2796): one box, and the kinds under it. */
describe("CourseSwitches — the gear the fee includes", () => {
  it("leaves the box unticked on a course that includes nothing, with the scuba unit preset beneath", () => {
    render(
      <CourseSwitches
        course={{ nitroxCompatible: true, includedRentalKinds: [] }}
        rentalItems={CATALOG}
        t={t}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Rental gear is part of the course fee" }),
    ).not.toBeChecked();
    // Every kind the shop rents, nitrox (a fill) never among them.
    expect(kindBoxes()).toEqual([
      { kind: "bcd", ticked: true },
      { kind: "regulator", ticked: true },
      { kind: "wetsuit", ticked: false },
      { kind: "mask", ticked: false },
      { kind: "fins", ticked: false },
      { kind: "weights", ticked: true },
      { kind: "gopro", ticked: false },
    ]);
  });

  it("ticks the box and exactly the kinds a course already includes", () => {
    render(
      <CourseSwitches
        course={{ nitroxCompatible: true, includedRentalKinds: ["wetsuit", "mask"] }}
        rentalItems={CATALOG}
        t={t}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Rental gear is part of the course fee" }),
    ).toBeChecked();
    expect(
      kindBoxes()
        .filter((box) => box.ticked)
        .map((box) => box.kind),
    ).toEqual(["wetsuit", "mask"]);
  });

  it("keeps an included kind the shop has since stopped renting, so a save does not drop it", () => {
    render(
      <CourseSwitches
        course={{ nitroxCompatible: true, includedRentalKinds: ["hood"] }}
        rentalItems={["bcd"]}
        t={t}
      />,
    );
    expect(kindBoxes()).toEqual([
      { kind: "bcd", ticked: false },
      { kind: "hood", ticked: true },
    ]);
  });
});
