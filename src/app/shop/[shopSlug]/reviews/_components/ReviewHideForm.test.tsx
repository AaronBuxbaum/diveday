// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewHideForm } from "./ReviewHideForm";

afterEach(cleanup);

const props = {
  reviewId: "review-1",
  action: vi.fn(async () => {}),
  reasons: [
    { value: "spam", label: "Spam" },
    { value: "other", label: "Something else" },
  ],
  reasonLabel: "Why are you taking it down?",
  reasonPlaceholder: "Choose a reason…",
  noteLabel: "What happened",
  notePlaceholder: "Only if you chose Something else",
  hideLabel: "Hide this review",
  savingLabel: "Saving…",
};

describe("ReviewHideForm", () => {
  it("does not render the free-text field until Something else is selected", async () => {
    const user = userEvent.setup();
    render(<ReviewHideForm {...props} />);

    expect(screen.queryByLabelText("What happened")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Why are you taking it down?"), "other");
    expect(screen.getByLabelText("What happened")).toBeInTheDocument();
    expect(screen.getByLabelText("What happened")).toBeRequired();

    await user.selectOptions(screen.getByLabelText("Why are you taking it down?"), "spam");
    expect(screen.queryByLabelText("What happened")).not.toBeInTheDocument();
  });
});
