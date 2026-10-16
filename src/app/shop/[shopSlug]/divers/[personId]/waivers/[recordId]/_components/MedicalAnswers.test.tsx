// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MedicalAnswers, type MedicalAnswersCopy } from "./MedicalAnswers";

afterEach(cleanup);

const copy: MedicalAnswersCopy = {
  yes: "Yes",
  no: "No",
  show: "Show answers",
  showing: "Showing…",
  showHint: "Opening them is noted on their record.",
  failed: "The answers couldn’t be shown. Try again.",
};
const flagged = [{ id: "Chest pain", prompt: "Chest pain", yes: true }];

/** Issue #2157: the full questionnaire is read on purpose, never at rest. */
describe("MedicalAnswers", () => {
  it("shows only the flagged prompts until the tap, then every answer", async () => {
    const show = vi.fn(async () => ({
      ok: true as const,
      answers: [
        { id: "q1", prompt: "Chest pain", yes: true },
        { id: "q2", prompt: "Asthma", yes: false },
      ],
    }));
    render(<MedicalAnswers flagged={flagged} show={show} emptyText={null} copy={copy} />);
    expect(screen.queryByText("Asthma")).toBeNull();
    expect(show).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show answers" }));

    await waitFor(() => expect(screen.getByText("Asthma")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Show answers" })).toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("says so when the answers could not be shown", async () => {
    const show = vi.fn(async () => ({ ok: false as const }));
    render(<MedicalAnswers flagged={[]} show={show} emptyText={null} copy={copy} />);

    fireEvent.click(screen.getByRole("button", { name: "Show answers" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy.failed));
  });

  it("offers no tap to a reader who may not read every answer", () => {
    render(
      <MedicalAnswers
        flagged={[]}
        emptyText="Only an owner or manager can read the full questionnaire."
        copy={copy}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Only an owner or manager/)).toBeInTheDocument();
  });
});
