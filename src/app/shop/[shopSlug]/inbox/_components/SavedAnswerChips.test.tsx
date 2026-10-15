// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SavedAnswerChips } from "./SavedAnswerChips";

afterEach(cleanup);

const ANSWERS = [
  { id: "a", title: "Parking", body: "Hi {name}, park behind the shop." },
  { id: "b", title: "Wetsuits", body: "I'll put one aside for {trip}." },
];

function Composer({ trip }: { trip: string | null }) {
  return (
    <form>
      <SavedAnswerChips answers={ANSWERS} fill={{ name: "Lena", trip }} label="Saved answers" />
      <textarea name="body" aria-label="Reply" maxLength={4000} />
    </form>
  );
}

describe("SavedAnswerChips", () => {
  it("puts the answer in the box, filled for this diver", () => {
    render(<Composer trip="Reef Morning on Oct 18 at 8:00 AM" />);
    fireEvent.click(screen.getByRole("button", { name: "Parking" }));
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveProperty(
      "value",
      "Hi Lena, park behind the shop.",
    );
  });

  it("keeps what was already typed and follows it after a blank line", () => {
    render(<Composer trip="Reef Morning on Oct 18 at 8:00 AM" />);
    const box = screen.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement;
    box.value = "Thanks for asking!";
    fireEvent.click(screen.getByRole("button", { name: "Wetsuits" }));
    expect(box.value).toBe(
      "Thanks for asking!\n\nI'll put one aside for Reef Morning on Oct 18 at 8:00 AM.",
    );
  });

  it("leaves the trip marker showing when the diver is booked on nothing", () => {
    render(<Composer trip={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Wetsuits" }));
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveProperty(
      "value",
      "I'll put one aside for {trip}.",
    );
  });

  it("renders nothing for a shop with no saved answers", () => {
    const { container } = render(
      <SavedAnswerChips answers={[]} fill={{ name: "Lena", trip: null }} label="Saved answers" />,
    );
    expect(container.innerHTML).toBe("");
  });
});
