// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NonBoatAlternativesPicker } from "./NonBoatAlternativesPicker";

afterEach(cleanup);

const copy = {
  title: "Priority alternatives",
  legend: "Existing departures",
  help: "No places are reserved.",
  limit: "Three selected.",
};
const options = [1, 2, 3, 4].map((number) => ({
  id: String(number),
  title: `Pool ${number}`,
  when: "Tomorrow",
  kind: "Pool diving",
}));

describe("non-boat alternative selection", () => {
  it("starts unselected and caps preference choices without blocking cancellation", () => {
    const { container } = render(<NonBoatAlternativesPicker options={options} copy={copy} />);
    fireEvent.click(screen.getByText(copy.title));
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    expect(checkboxes[3]).toBeDisabled();
    expect(screen.getByText(copy.limit)).toBeVisible();
    expect(container.querySelectorAll('input[name="alternativeTripId"]:checked')).toHaveLength(3);
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[3]).not.toBeDisabled();
  });
  it("does not add an empty optional chooser", () => {
    const { container } = render(<NonBoatAlternativesPicker options={[]} copy={copy} />);
    expect(container).toBeEmptyDOMElement();
  });
});
