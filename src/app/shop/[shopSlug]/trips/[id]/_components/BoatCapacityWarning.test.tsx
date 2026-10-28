// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoatCapacityWarning } from "./BoatCapacityWarning";

afterEach(cleanup);

describe("BoatCapacityWarning", () => {
  it("follows the seats, selected boat and mode without preventing submission", () => {
    render(
      <form>
        <input name="capacity" aria-label="Seats" type="number" defaultValue="6" />
        <select name="boatId" aria-label="Boat" defaultValue="a">
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
        <select name="diveMode" aria-label="Mode" defaultValue="boat">
          <option value="boat">Boat</option>
          <option value="shore">Shore</option>
        </select>
        <BoatCapacityWarning
          boats={[
            { id: "a", capacity: 6 },
            { id: "b", capacity: 10 },
          ]}
          initialMode="boat"
          copy="Boat has {count} seats."
        />
        <button type="submit">Save</button>
      </form>,
    );
    fireEvent.change(screen.getByLabelText("Seats"), { target: { value: "8" } });
    expect(screen.getByText("Boat has 6 seats.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Boat"), { target: { value: "b" } });
    expect(screen.queryByText("Boat has 6 seats.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Seats"), { target: { value: "11" } });
    expect(screen.getByText("Boat has 10 seats.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "shore" } });
    expect(screen.queryByText("Boat has 10 seats.")).not.toBeInTheDocument();
  });
});

it("uses the current assigned boat in a section without a boat selector and reacts to a new assignment", () => {
  const form = (boatId: string) => (
    <form>
      <input name="capacity" aria-label="Seats" type="number" defaultValue="8" />
      <BoatCapacityWarning
        boats={[
          { id: "a", capacity: 6 },
          { id: "b", capacity: 10 },
        ]}
        initialMode="boat"
        assignedBoatId={boatId}
        copy="Boat has {count} seats."
      />
    </form>
  );
  const { rerender } = render(form("a"));
  expect(screen.getByText("Boat has 6 seats.")).toBeInTheDocument();
  rerender(form("b"));
  expect(screen.queryByText("Boat has 6 seats.")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Seats"), { target: { value: "11" } });
  expect(screen.getByText("Boat has 10 seats.")).toBeInTheDocument();
});

it("uses the current seat count when the boat editor selects a smaller configured hull", () => {
  render(
    <form>
      <select name="boatId" aria-label="Boat" defaultValue="a">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
      <BoatCapacityWarning
        boats={[
          { id: "a", capacity: 10 },
          { id: "b", capacity: 6 },
        ]}
        initialMode="boat"
        currentCapacity={8}
        copy="Boat has {count} seats."
      />
      <button type="submit">Save</button>
    </form>,
  );
  expect(screen.queryByText("Boat has 6 seats.")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Boat"), { target: { value: "b" } });
  expect(screen.getByText("Boat has 6 seats.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});
