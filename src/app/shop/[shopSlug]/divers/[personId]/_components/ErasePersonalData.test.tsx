// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErasePersonalData } from "./ErasePersonalData";
import type { DiverProfile } from "./shared";

vi.mock("../actions", () => ({ erasePersonAction: vi.fn() }));

afterEach(cleanup);

const diver = {
  person: { id: "person-1", fullName: "Mira Castellanos", deletedAt: new Date(0) },
} as unknown as DiverProfile;

/**
 * **The typed-name box stands level with "Erase personal data".** The box was
 * the stacked field's 44px beside the `md` button's 48px, and the row is
 * `items-end`, so the button stood 4px above the box's top edge. The box
 * inside a `Field` is grouped with its caption, so the pixel probe's row
 * checks never compared the two; this was found by reading the code (review
 * of 2026-09-25).
 *
 * jsdom lays nothing out, so this pins which element carries which size, not
 * the pixels. The row sits inside a shut disclosure, hence `hidden: true`.
 */
describe("ErasePersonalData", () => {
  it("gives the typed-name box the md height of the erase button beside it", () => {
    render(
      <ErasePersonalData diver={diver} shopSlug="blue-mantis" personId="person-1" locale="en-US" />,
    );
    const box = screen.getByPlaceholderText("Mira Castellanos");
    const erase = screen.getByRole("button", { name: "Erase personal data", hidden: true });
    expect(erase).toHaveClass("min-h-12", "text-base");
    expect(box).toHaveClass("min-h-12", "text-base");
    expect(box).not.toHaveClass("min-h-11");
  });
});
