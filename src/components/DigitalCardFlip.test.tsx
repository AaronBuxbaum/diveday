// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DigitalCardFlip } from "./DigitalCardFlip";

afterEach(() => {
  cleanup();
});

describe("DigitalCardFlip", () => {
  const props = {
    fullName: "Maya Álvarez",
    agencyLabel: "PADI",
    levelLabel: "Open Water Diver",
    identifier: "PADI-OW-99887",
    cardImageUrl: "https://example.com/card.jpg",
    verificationStatus: "verified" as const,
  };

  it("renders the certification details on the front of the card", () => {
    render(<DigitalCardFlip {...props} />);

    expect(screen.getByText("PADI")).toBeInTheDocument();
    expect(screen.getByText("Open Water Diver")).toBeInTheDocument();
    expect(screen.getByText("Maya Álvarez")).toBeInTheDocument();
    expect(screen.getByText("Card #: PADI-OW-99887")).toBeInTheDocument();
    expect(screen.getByText("DIVEDAY VERIFIED")).toBeInTheDocument();
  });

  it("renders the uploaded card image on the back of the card if present", () => {
    render(<DigitalCardFlip {...props} />);

    const img = screen.getByRole("img", { name: /uploaded certification card/i });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/card.jpg");
  });

  it("renders the database verified placeholder on the back if cardImageUrl is null", () => {
    render(<DigitalCardFlip {...props} cardImageUrl={null} />);

    expect(screen.getByText("NO CARD PHOTO")).toBeInTheDocument();
    expect(screen.getByText("Verified via online database query")).toBeInTheDocument();
  });

  it("toggles the flip status when the button is clicked", () => {
    render(<DigitalCardFlip {...props} />);

    const button = screen.getByRole("button", { name: /digital certification card/i });
    const cardInner = button.firstElementChild;
    expect(cardInner).toHaveStyle({ transform: "rotateY(0deg)" });

    // Click to flip
    fireEvent.click(button);
    expect(cardInner).toHaveStyle({ transform: "rotateY(180deg)" });

    // Click again to unflip
    fireEvent.click(button);
    expect(cardInner).toHaveStyle({ transform: "rotateY(0deg)" });
  });

  it("does not claim verification for pending or expired cards", () => {
    const { rerender } = render(<DigitalCardFlip {...props} verificationStatus="pending" />);
    expect(screen.getByText("PENDING REVIEW")).toBeInTheDocument();
    expect(screen.queryByText("DIVEDAY VERIFIED")).toBeNull();

    rerender(<DigitalCardFlip {...props} verificationStatus="expired" />);
    expect(screen.getByText("REFRESHER DUE")).toBeInTheDocument();
    expect(screen.queryByText("DIVEDAY VERIFIED")).toBeNull();
  });
});
