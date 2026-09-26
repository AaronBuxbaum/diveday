// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toDataURL = vi.fn(async (_value: string, _options: object) => "data:image/png;base64,AAAA");
vi.mock("qrcode", () => ({ default: { toDataURL } }));

const { SheetCode } = await import("./SheetCode");

afterEach(() => {
  cleanup();
  toDataURL.mockClear();
});

/**
 * **A code's ink starts where the text column starts.**
 *
 * The code was encoded with one white module inside its own image, so its
 * black edge stood a module inside the box the sheet lines up: the pixel probe
 * measured the paper pass's finder pattern 3px right of the title above it,
 * and the dock sign's two codes 2px and 4px right of their captions. The
 * sheet's own white is the quiet zone, so the image carries none; each call
 * site keeps four modules of paper clear around it.
 */
describe("a code on a sheet", () => {
  it("encodes with no quiet zone of its own", async () => {
    render(await SheetCode({ value: "booking-1", label: "Your pass", className: "w-[24mm]" }));
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(toDataURL.mock.calls[0]?.[0]).toBe("booking-1");
    expect(toDataURL.mock.calls[0]?.[1]).toMatchObject({ margin: 0 });
    const image = screen.getByRole("img", { name: "Your pass" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(image).toHaveClass("w-[24mm]");
  });
});
