// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * **Four modules of paper on every side that faces words.** With no quiet
 * zone in the image, the clearance is the call site's, and it was short on
 * two of them: the window sticker's `gap-5` is 4.3mm at the 13px print root,
 * the dock sign's `mt-3` under each code 2.6mm, where the image's own module
 * had carried them before. A module is the code's printed width over its
 * module count, and the count falls with the payload: the coarsest code any
 * absolute URL makes is a version 2, 25 modules, which is what a storefront
 * link on a short slug prints. A booking id is always a version 3.
 */
describe("the paper each call site keeps clear of its code", () => {
  const PRINT = join(import.meta.dirname, "..");
  const source = (page: string) => readFileSync(join(PRINT, page), "utf8");
  /** A spacing class in paper millimetres; a rem step at the 13px print root. */
  const mm = (token: string) => {
    const paper = token.match(/\[([\d.]+)mm\]$/);
    if (paper) return Number(paper[1]);
    const step = token.match(/-(\d+(?:\.\d+)?)$/);
    if (!step) throw new Error(`not a spacing class: ${token}`);
    return ((Number(step[1]) * 0.25 * 13) / 96) * 25.4;
  };

  async function modules(value: string) {
    const actual = await vi.importActual<typeof import("qrcode")>("qrcode");
    return actual.default.create(value).modules.size;
  }

  it("takes a URL code's floor from the coarsest version a URL can be", async () => {
    // The shortest absolute URL of the storefront's shape.
    expect(await modules("https://a.b/s/c")).toBe(25);
    expect(await modules("0b6f1f3e-5a51-4a0e-9d7e-2f0c7b7f4a11")).toBe(29);
  });

  it("keeps the window sticker's sentence four modules above its code", async () => {
    const page = source("window-sticker/page.tsx");
    const gap = page.match(/className="flex flex-col items-center (gap-[^\s"]+) text-center"/)?.[1];
    const width = page.match(/<SheetCode[\s\S]*?className="w-\[(\d+)mm\]"/)?.[1];
    expect(gap && width).toBeTruthy();
    expect(mm(gap ?? "")).toBeGreaterThanOrEqual(
      (4 * Number(width)) / (await modules("https://a.b/s/c")),
    );
  });

  it("keeps each dock-sign caption four modules below its code", async () => {
    const page = source("dock-sign/page.tsx");
    const sites = [
      ...page.matchAll(
        /<SheetCode[\s\S]*?className="w-\[(\d+)mm\]"\s*\/>(?:\s*\{\/\*[\s\S]*?\*\/\})?\s*<p className="[^"]*\b(mt-[^\s"]+)/g,
      ),
    ];
    expect(sites).toHaveLength(2);
    const floor = await modules("https://a.b/s/c");
    for (const [, width, margin] of sites) {
      expect(mm(margin ?? "")).toBeGreaterThanOrEqual((4 * Number(width)) / floor);
    }
  });

  it("keeps the pass's words four modules beside its code", async () => {
    const page = source("pass/[bookingId]/page.tsx");
    const row = page.match(/className="mt-4 flex items-center (gap-[^\s"]+)"[\s\S]*?w-\[(\d+)mm\]/);
    expect(row).toBeTruthy();
    const [, gap = "", width = "0"] = row ?? [];
    expect(mm(gap)).toBeGreaterThanOrEqual(
      (4 * Number(width)) / (await modules("0b6f1f3e-5a51-4a0e-9d7e-2f0c7b7f4a11")),
    );
  });
});
