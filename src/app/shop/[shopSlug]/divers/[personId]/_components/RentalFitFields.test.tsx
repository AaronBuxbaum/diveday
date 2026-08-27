// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { RentalFitFields, type RentalFitSize, type RentalFitToggle } from "./RentalFitFields";

afterEach(cleanup);

const TOGGLES: RentalFitToggle[] = [
  { name: "bcd", label: "BCD", defaultChecked: true },
  { name: "wetsuit", label: "Wetsuit", defaultChecked: true },
  { name: "maskFins", label: "Mask & fins", defaultChecked: false },
];

const SIZES: RentalFitSize[] = [
  {
    name: "bcdSize",
    label: "BCD size",
    placeholder: "M",
    defaultValue: "L",
    requires: ["bcd"],
  },
  {
    name: "finSize",
    label: "Fin & boot size",
    placeholder: "US 9",
    defaultValue: "US 11",
    requires: ["maskFins", "wetsuit"],
  },
];

function renderFields() {
  return render(<RentalFitFields legend="Rents from the shop" toggles={TOGGLES} sizes={SIZES} />);
}

/** The one thing a hidden size must still do: reach the save. */
function submitted(container: HTMLElement, name: string): string | null {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  return input ? input.value : null;
}

describe("RentalFitFields", () => {
  it("asks only for the sizes this diver actually rents", async () => {
    renderFields();
    // BCD is ticked, so its size is a question worth asking.
    expect(screen.getByLabelText("BCD size")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("BCD"));
    expect(screen.queryByLabelText("BCD size")).toBeNull();
  });

  it("keeps the size on file, so re-ticking brings the old answer back", async () => {
    // The point of hiding rather than dropping: a diver who skips a wetsuit in
    // August has not forgotten what size they take in January.
    const { container } = renderFields();
    await userEvent.click(screen.getByLabelText("BCD"));
    expect(screen.queryByLabelText("BCD size")).toBeNull();
    // Still submitted, so the save writes what was already on file.
    expect(submitted(container, "bcdSize")).toBe("L");

    await userEvent.click(screen.getByLabelText("BCD"));
    expect(screen.getByLabelText("BCD size")).toHaveValue("L");
  });

  it("does not lose what was typed while the box is hidden", async () => {
    // The value is controlled for exactly this: an unmounted *uncontrolled*
    // input forgets what was typed into it, which is the one thing this must
    // never do.
    const { container } = renderFields();
    await userEvent.clear(screen.getByLabelText("BCD size"));
    await userEvent.type(screen.getByLabelText("BCD size"), "XL");
    await userEvent.click(screen.getByLabelText("BCD"));
    expect(submitted(container, "bcdSize")).toBe("XL");
    await userEvent.click(screen.getByLabelText("BCD"));
    expect(screen.getByLabelText("BCD size")).toHaveValue("XL");
  });

  it("keeps one shoe size for either tick that puts it on the packing list", async () => {
    // Fin & boot size rides along with a wetsuit as well as with fins, which is
    // why the save writes it to both columns — so either tick asks for it, and
    // it takes both being off to drop the question.
    renderFields();
    expect(screen.getByLabelText("Fin & boot size")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Wetsuit"));
    expect(screen.queryByLabelText("Fin & boot size")).toBeNull();
    await userEvent.click(screen.getByLabelText("Mask & fins"));
    expect(screen.getByLabelText("Fin & boot size")).toBeInTheDocument();
  });
});
