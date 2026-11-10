// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiverRentalFit } from "@/db/rental-fit";
import { NOTHING_RENTED } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { RentalFitForm } from "./RentalFitForm";

const drysuitFit: DiverRentalFit = {
  ...NOTHING_RENTED,
  rentsDrysuit: true,
  divesDry: true,
  bcdSize: null,
  wetsuitSize: null,
  drysuitSize: null,
  hoodSize: null,
  gloveSize: null,
  bootSize: null,
  finSize: null,
  weightPreference: null,
  note: null,
  fitStatedAt: new Date("2026-07-21T13:30:00.000Z"),
};

afterEach(cleanup);

describe("RentalFitForm approved short cuts (issue #4221)", () => {
  function renderDrysuit(fit: Partial<DiverRentalFit> = {}) {
    return renderDiver(
      <RentalFitForm
        action={vi.fn()}
        rentalFit={{ ...drysuitFit, ...fit }}
        rentalItems={["drysuit"]}
        course={null}
        pricing={{ setCents: null, perItemCents: {}, nitroxCents: null }}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
  }

  function drysuitSelect(container: HTMLElement) {
    return container.querySelector('select[name="drysuitSize"]') as HTMLSelectElement;
  }

  function submitted(container: HTMLElement, field: string) {
    const form = container.querySelector("form") as HTMLFormElement;
    return new FormData(form).get(field);
  }

  it.each(["MS", "LS", "XLS"])("keeps a saved %s selected once on the grid", (size) => {
    const { container } = renderDrysuit({ drysuitSize: size });
    const select = drysuitSelect(container);
    expect(select.value).toBe(size);
    expect([...select.options].filter((option) => option.value === size)).toHaveLength(1);
    expect(select.selectedOptions[0]).toHaveTextContent(size);
    expect(select.selectedOptions[0]).not.toHaveTextContent("on file from the shop");
    expect(submitted(container, "drysuitSize")).toBe(size);
  });

  it("lets a diver choose each short cut and return to an uncertain fit", () => {
    const { container } = renderDrysuit();
    const select = drysuitSelect(container);
    const indicator = screen.getByTestId("gear-status-indicator");
    expect(select.options[0]).toHaveTextContent("Not sure");
    for (const size of ["MS", "LS", "XLS"]) {
      fireEvent.change(select, { target: { value: size } });
      expect(submitted(container, "drysuitSize")).toBe(size);
      expect(indicator).toHaveTextContent("Sizes recorded");
      expect(indicator).toHaveTextContent("dock");
    }
    fireEvent.change(select, { target: { value: "" } });
    expect(submitted(container, "drysuitSize")).toBe("");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");
  });
});
