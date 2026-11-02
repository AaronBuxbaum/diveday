// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareReviewButton } from "./ShareReviewButton";

afterEach(() => {
  cleanup();
});

describe("ShareReviewButton (task 57)", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  });

  it("copies the diver's own comment to the clipboard and swaps the label", async () => {
    render(
      <ShareReviewButton
        reviewUrl="https://g.page/r/blue-mantis/review"
        comment="Great crew, great viz."
        cta="Leave a public review"
        copiedLabel="Copied — paste it in when you get there"
      />,
    );
    const link = screen.getByRole("link", { name: "Leave a public review" });
    expect(link).toHaveAttribute("href", "https://g.page/r/blue-mantis/review");
    expect(link).toHaveAttribute("target", "_blank");

    fireEvent.click(link);
    expect(writeText).toHaveBeenCalledWith("Great crew, great viz.");
    expect(await screen.findByText("Copied — paste it in when you get there")).toBeInTheDocument();
  });

  it("never touches the clipboard for a bare rating with no written words", async () => {
    render(
      <ShareReviewButton
        reviewUrl="https://g.page/r/blue-mantis/review"
        comment={null}
        cta="Leave a public review"
        copiedLabel="Copied — paste it in when you get there"
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "Leave a public review" }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("link")).toHaveTextContent("Leave a public review");
  });
});
