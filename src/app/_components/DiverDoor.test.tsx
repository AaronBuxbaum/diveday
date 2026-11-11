// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { DiverDoor } from "./DiverDoor";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the home hero's line for a diver", () => {
  it("is not drawn until HOME_DIVER_DOOR is on, so no owner is led to an empty shop list", () => {
    vi.stubEnv("HOME_DIVER_DOOR", "");
    const { container } = render(<DiverDoor t={diverTranslator("en-US")} />);
    expect(container.innerHTML).toBe("");
  });

  it("is one link to /find-your-booking once the switch is on", () => {
    vi.stubEnv("HOME_DIVER_DOOR", "1");
    render(<DiverDoor t={diverTranslator("en-US")} />);
    const link = screen.getByRole("link", { name: "Find your booking" });
    expect(link.getAttribute("href")).toBe("/find-your-booking");
  });
});
