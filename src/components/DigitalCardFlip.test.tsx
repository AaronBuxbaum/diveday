// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DigitalCardFlip, type DigitalCardFlipCopy } from "./DigitalCardFlip";

afterEach(() => {
  cleanup();
});

const copy: DigitalCardFlipCopy = {
  diverLabel: "Diver",
  cardNumberText: "Card #: PADI-OW-99887",
  statusVerified: "DIVEDAY VERIFIED",
  statusRefresherDue: "REFRESHER DUE",
  statusPending: "PENDING REVIEW",
  noPhoto: "NO CARD PHOTO",
  certifiedByStaff: "Certified by staff",
  refresherDueVerify: "Refresher due — verify current status with the agency",
  awaitingVerification: "Awaiting staff verification",
  idText: "ID: PADI-OW-99887",
  secureLabel: "DIVEDAY SECURE",
  openFullSize: "Open full-size card photo ↗",
  tapToFlipText: "Tap the card to flip and view the uploaded photo",
  flipAriaLabel: "Digital certification card for Open Water Diver. Press to flip.",
  uploadedAlt: "Uploaded certification card",
};

describe("DigitalCardFlip", () => {
  const props = {
    fullName: "Maya Álvarez",
    agencyLabel: "PADI",
    levelLabel: "Open Water Diver",
    cardImageUrl: "https://example.com/card.jpg",
    verificationStatus: "verified" as const,
    copy,
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
    expect(img).toHaveClass("object-contain");
    expect(screen.getByRole("link", { name: /open full-size card photo/i })).toHaveAttribute(
      "href",
      "https://example.com/card.jpg",
    );
    expect(img).toHaveAttribute("src", "https://example.com/card.jpg");
  });

  it("renders the certified placeholder on the back if cardImageUrl is null", () => {
    render(<DigitalCardFlip {...props} cardImageUrl={null} />);

    expect(screen.getByText("NO CARD PHOTO")).toBeInTheDocument();
    expect(screen.getByText("Certified by staff")).toBeInTheDocument();
  });

  it("toggles the flip status when the flip control is clicked", () => {
    render(<DigitalCardFlip {...props} />);

    // The flip control is its own small labeled button — not a wrapper around
    // the whole card, so the card's own text (agency, level, name, status)
    // stays in the accessibility tree instead of being replaced by the
    // button's aria-label.
    const button = screen.getByRole("button", { name: /digital certification card/i });
    const cardInner = screen.getByTestId("digital-card-inner");
    expect(cardInner).toHaveStyle({ transform: "rotateY(0deg)" });

    // Click to flip
    fireEvent.click(button);
    expect(cardInner).toHaveStyle({ transform: "rotateY(180deg)" });

    // Click again to unflip
    fireEvent.click(button);
    expect(cardInner).toHaveStyle({ transform: "rotateY(0deg)" });
  });

  it("keeps the card's own text readable to assistive tech instead of folding it into the flip button's name", () => {
    render(<DigitalCardFlip {...props} />);

    const button = screen.getByRole("button", { name: /digital certification card/i });
    // The card's front-face text must not be inside the labeled button — an
    // `aria-label` on an ancestor would otherwise replace all of it.
    expect(button).not.toHaveTextContent("PADI");
    expect(button).not.toHaveTextContent("Maya Álvarez");
    expect(screen.getByText("PADI")).toBeInTheDocument();
    expect(screen.getByText("Maya Álvarez")).toBeInTheDocument();
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
