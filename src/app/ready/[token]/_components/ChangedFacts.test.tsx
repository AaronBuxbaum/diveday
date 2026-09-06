// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiverRentalFit } from "@/db/rental-fit";
import { diverTranslator } from "@/i18n/messages";
import { ChangedFacts, type FitRecall } from "./ChangedFacts";

/**
 * **"Anything changed?"**, pinned as rules (ADR 20260904-reef-all-the-way-down,
 * D15 with D19 folded in, and D14 for the recall line).
 *
 * The one that carries the most weight is the last: each fact has its own
 * action. A door that posted through another fact's form would clear fields the
 * diver never touched, which is issue #1175's named trap and the whole reason
 * this panel is three doors rather than one form.
 */
const t = diverTranslator("en-US");

afterEach(cleanup);

function storedFit(overrides: Partial<DiverRentalFit> = {}): DiverRentalFit {
  return {
    rentsBcd: true,
    rentsRegulator: true,
    rentsWetsuit: true,
    rentsMaskFins: true,
    rentsWeights: true,
    rentsDiveComputer: false,
    rentsGopro: false,
    rentsDrysuit: false,
    rentsHoodGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: "M",
    wetsuitSize: "M",
    bootSize: "9",
    finSize: "9",
    weightPreference: "16 lb",
    note: null,
    fitStatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

/** Distinct no-op actions, so a test can tell which door posts to which. */
function actions() {
  return {
    confirm: () => {},
    saveTanks: (_formData: FormData) => {},
    saveContact: (_formData: FormData) => {},
  };
}

function panel(
  overrides: Partial<React.ComponentProps<typeof ChangedFacts>> = {},
): React.ReactElement {
  return (
    <ChangedFacts
      t={t}
      locale="en-US"
      fit={storedFit()}
      wantsNitrox={false}
      offerNitrox
      emergencyContact={{ name: "Sam Quinn", phone: "+1-305-555-0100" }}
      fitRecall={null}
      fitForm={<div data-testid="fit-form" />}
      actions={actions()}
      {...overrides}
    />
  );
}

describe("the three facts", () => {
  it("names each one beside what the shop is currently holding", () => {
    render(panel());

    expect(screen.getByText("Sizes")).toBeInTheDocument();
    // The sizes on file, item by item — never a summary the panel composed.
    expect(screen.getByText(/BCD M/)).toBeInTheDocument();
    expect(screen.getByText(/Wetsuit M/)).toBeInTheDocument();

    expect(screen.getByText("Tanks")).toBeInTheDocument();
    // Twice: the row's current value, and the door's own selected option.
    expect(screen.getAllByText("Air").length).toBeGreaterThan(0);

    expect(screen.getByText("Emergency contact")).toBeInTheDocument();
    expect(screen.getByText(/Sam Quinn/)).toBeInTheDocument();
  });

  it("reads a diver's own kit back as their own answer, not as a blank", () => {
    render(
      panel({
        fit: storedFit({
          bcdSize: null,
          wetsuitSize: null,
          bootSize: null,
          finSize: null,
          weightPreference: null,
        }),
      }),
    );
    expect(screen.getByText(/Bringing own gear/)).toBeInTheDocument();
  });

  it("says the tanks row's current answer when nitrox is already requested", () => {
    render(panel({ wantsNitrox: true }));
    // The value line and the door's own option both read Nitrox.
    expect(screen.getAllByText("Nitrox").length).toBeGreaterThan(0);
  });

  it("drops the tanks row entirely when the shop cannot fill nitrox", () => {
    render(panel({ offerNitrox: false }));
    expect(screen.queryByText("Tanks")).not.toBeInTheDocument();
    expect(screen.queryByText("Air or nitrox?")).not.toBeInTheDocument();
  });

  it("says an empty emergency contact is empty, and still opens its door", () => {
    // Nothing renders quietly: the gap the Evening board reads as "dived
    // without an emergency contact" is the same gap seen from the diver's side.
    render(panel({ emergencyContact: { name: null, phone: null } }));
    expect(screen.getByText("Not on file")).toBeInTheDocument();
    expect(screen.getByLabelText("Contact name")).toBeInTheDocument();
    expect(screen.getByLabelText("Contact phone")).toBeInTheDocument();
  });
});

describe("the recall line", () => {
  const recall: FitRecall = { staffFullName: "Keiko Tanaka", item: "bcd", size: "M" };

  it("names the staffer, the piece and the size the shop is holding", () => {
    render(panel({ fitRecall: recall }));
    expect(
      screen.getByText("Keiko Tanaka kept your BCD at M after your last trip."),
    ).toBeInTheDocument();
  });

  it("renders nothing at all without a confirmation", () => {
    render(panel({ fitRecall: null }));
    expect(screen.queryByText(/kept your/)).not.toBeInTheDocument();
  });
});

describe("one primary act, and three separate doors", () => {
  it("offers exactly one primary button, and it is the answer 'nothing changed'", () => {
    const { container } = render(panel());
    const primary = screen.getByRole("button", { name: "Nothing changed" });
    expect(primary).toBeInTheDocument();
    // Every other button on the panel is a secondary save.
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.filter((button) => button.textContent === "Nothing changed")).toHaveLength(1);
    expect(buttons.length).toBeGreaterThan(1);
  });

  it("keeps every fact inside its own form, so no post can reach another's fields", () => {
    const { container } = render(panel());
    const forms = Array.from(container.querySelectorAll("form"));
    // Three forms of its own: tanks, contact, and the confirm. The sizes form is
    // the page's node, handed in whole.
    expect(forms).toHaveLength(3);

    const named = (form: Element) =>
      Array.from(form.querySelectorAll("[name]")).map((field) => field.getAttribute("name"));
    expect(forms.map(named)).toEqual([
      ["nitrox"],
      ["emergencyContactName", "emergencyContactPhone"],
      // The answer "nothing changed" posts no fact at all, which is the point
      // of it: nothing moved.
      [],
    ]);
    // And every one of them submits on its own.
    for (const form of forms) {
      expect(form.querySelectorAll("button[type='submit']")).toHaveLength(1);
    }
  });

  it("opens the page's own sizes form behind the Sizes door", () => {
    render(panel());
    // Never a second sizes form of its own: the one that owns every size column
    // is composed by the page and handed in.
    expect(screen.getByTestId("fit-form")).toBeInTheDocument();
  });
});
