// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toDataURL = vi.fn(async (_value: string, _options: object) => "data:image/png;base64,AAAA");
/** A version 2 symbol: 25 modules a side, what a short storefront link makes. */
const create = vi.fn((_value: string) => ({ modules: { size: 25 } }));
vi.mock("qrcode", () => ({ default: { toDataURL, create } }));

const { SheetCode, SHEET_CODE_OPTIONS, QUIET_ZONE_MODULES } = await import("./SheetCode");

afterEach(() => {
  cleanup();
  toDataURL.mockClear();
});

/**
 * **A code carries its own quiet zone, and its ink still starts where the text
 * column starts.**
 *
 * The code was encoded with one white module inside its own image, so its
 * black edge stood a module inside the box the sheet lines up: the pixel probe
 * measured the paper pass's finder pattern 3px right of the title above it,
 * and the dock sign's two codes 2px and 4px right of their captions. Encoding
 * it with no margin lined the ink up but left the code's quiet zone to whatever
 * paper happened to be around it — at the dock sign's left edge, less than the
 * four modules a scanner is owed (dive-domain review, K-284). The image
 * carries the full quiet zone now, and the box is drawn at the symbol's size
 * with the quiet zone overhanging it on every side: the ink sits on the
 * caller's column, and the white the scan needs travels with the code.
 */
describe("a code on a sheet", () => {
  it("encodes the four-module quiet zone the QR spec asks for", async () => {
    render(await SheetCode({ value: "booking-1", label: "Your pass", size: 24 }));
    expect(QUIET_ZONE_MODULES).toBe(4);
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(toDataURL.mock.calls[0]?.[0]).toBe("booking-1");
    expect(toDataURL.mock.calls[0]?.[1]).toMatchObject({ margin: 4 });
    const image = screen.getByRole("img", { name: "Your pass" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("draws the symbol at the caller's size, its quiet zone overhanging the box", async () => {
    // 32mm over 25 modules is 1.28mm a module, so 5.12mm of quiet zone.
    render(await SheetCode({ value: "https://a.b/s/c", label: "Check in", size: 32 }));
    const image = screen.getByRole("img", { name: "Check in" });
    expect(image.style.width).toBe("42.24mm");
    expect(image.style.margin).toBe("-5.12mm");
    // Preflight's `max-width: 100%` would shrink the overhanging box in a
    // narrow column, and the symbol with it.
    expect(image).toHaveClass("max-w-none");
  });

  /**
   * The encoder is read for real here: what the sheet prints is this PNG, so
   * the quiet zone is asserted in its pixels rather than in the option that
   * asks for it.
   */
  it("renders a code whose outer four modules are white on every side", async () => {
    const actual = await vi.importActual<{ default: typeof import("qrcode") }>("qrcode");
    const require = createRequire(createRequire(import.meta.url).resolve("qrcode"));
    const { PNG } = require("pngjs") as {
      PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
    };
    for (const value of ["https://a.b/s/c", "0b6f1f3e-5a51-4a0e-9d7e-2f0c7b7f4a11"]) {
      const url = await actual.default.toDataURL(value, SHEET_CODE_OPTIONS);
      const png = PNG.sync.read(Buffer.from(url.split(",")[1] ?? "", "base64"));
      const modules = actual.default.create(value).modules.size + 2 * QUIET_ZONE_MODULES;
      const quiet = Math.floor((png.width / modules) * QUIET_ZONE_MODULES);
      const dark = (x: number, y: number) => (png.data[(y * png.width + x) * 4] ?? 255) < 128;
      for (let i = 0; i < png.width; i++) {
        for (let depth = 0; depth < quiet; depth++) {
          expect(dark(i, depth), `${value}: top edge at ${i},${depth}`).toBe(false);
          expect(dark(i, png.height - 1 - depth), `${value}: bottom edge`).toBe(false);
          expect(dark(depth, i), `${value}: start edge`).toBe(false);
          expect(dark(png.width - 1 - depth, i), `${value}: end edge`).toBe(false);
        }
      }
      // And the finder pattern's corner is the first ink inside it.
      expect(dark(quiet + 2, quiet + 2), value).toBe(true);
    }
  });
});

/**
 * **Four modules clear on every side that faces words.** The quiet zone
 * overhangs the code's box, so the words beside it keep at least that much
 * room or the white is painted over them: the window sticker's `gap-5` was
 * 4.3mm at the 13px print root, the dock sign's `mt-3` under each code 2.6mm.
 * A module is the code's printed width over its module count, and the count
 * falls with the payload: the coarsest code any absolute URL makes is a
 * version 2, 25 modules, which is what a storefront link on a short slug
 * prints. A booking id is always a version 3.
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
    // The encoder is CommonJS, read the way `SheetCode` reads it: its default.
    const actual = await vi.importActual<{ default: typeof import("qrcode") }>("qrcode");
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
    const width = page.match(/<SheetCode[\s\S]*?size=\{(\d+)\}/)?.[1];
    expect(gap && width).toBeTruthy();
    expect(mm(gap ?? "")).toBeGreaterThanOrEqual(
      (4 * Number(width)) / (await modules("https://a.b/s/c")),
    );
  });

  it("keeps each dock-sign caption four modules below its code", async () => {
    const page = source("dock-sign/page.tsx");
    const sites = [
      ...page.matchAll(
        /<SheetCode[\s\S]*?size=\{(\d+)\}[^>]*?\/>(?:\s*\{\/\*[\s\S]*?\*\/\})?\s*<p className="[^"]*\b(mt-[^\s"]+)/g,
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
    const row = page.match(
      /className="mt-4 flex items-center (gap-[^\s"]+)"[\s\S]*?size=\{(\d+)\}/,
    );
    expect(row).toBeTruthy();
    const [, gap = "", width = "0"] = row ?? [];
    expect(mm(gap)).toBeGreaterThanOrEqual(
      (4 * Number(width)) / (await modules("0b6f1f3e-5a51-4a0e-9d7e-2f0c7b7f4a11")),
    );
  });
});
