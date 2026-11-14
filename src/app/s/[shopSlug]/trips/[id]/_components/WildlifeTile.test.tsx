// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { WildlifeTile } from "./WildlifeTile";

afterEach(cleanup);
it("shows a selected animal's photo and sighting, and reveals its note on hover, focus and tap", () => {
  const card = marineLifeCard("green-sea-turtle", diverTranslator("en-US"));
  const { container } = render(
    <ul>
      <WildlifeTile
        card={card}
        seen
        seenLabel="Seen here this month"
        photo={card.imageUrl}
        sizes="100px"
      />
    </ul>,
  );
  const button = screen.getByRole("button", { name: /Green sea turtle/ });
  expect(container.querySelector("img")).toHaveAttribute("src");
  expect(button.querySelector("svg")).not.toBeNull();
  expect(screen.getByText("Seen here this month")).toBeInTheDocument();
  const tile = container.querySelector("li");
  if (!tile) throw new Error("missing tile");
  fireEvent.pointerEnter(tile, { pointerType: "mouse" });
  expect(button).toHaveAttribute("aria-expanded", "true");
  fireEvent.pointerLeave(tile, { pointerType: "mouse" });
  fireEvent.focus(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(button, { key: "Escape" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.pointerDown(button, { pointerType: "touch" });
  fireEvent.click(button, { detail: 1 });
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("tooltip")).toHaveTextContent(card.description);
});
