// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { diverTranslator } from "@/i18n/messages";

vi.mock("@/features/crew-and-boats/boats", () => ({
  getBoatById: vi.fn(async () => ({ name: "Mantis I", photoUrl: "/demo-shop/boat.webp" })),
}));
const { TripBoatPhoto } = await import("./TripHero");

it("asks for the boat thumbnail at twice its 96px box, not at its own size", async () => {
  const ui = await TripBoatPhoto({
    db: {} as AppDb,
    shopId: "shop",
    boatId: "boat",
    t: diverTranslator("en-US"),
  });
  const { container } = render(ui);
  expect(container.querySelector("img")?.getAttribute("sizes")).toBe("192px");
});
