// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceTextSizeScript } from "./rules";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-device-text-size");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function exposeBodySize(size: string, supported = true, rootSize = "16px") {
  vi.stubGlobal("CSS", { supports: vi.fn(() => supported) });
  vi.stubGlobal("getComputedStyle", (element: Element) => ({
    fontSize: element === document.documentElement ? rootSize : size,
  }));
}

describe("device text size (ADR 20260907-in-your-hands, 19d)", () => {
  it("marks an applied increase so its reflow cannot change the ordinary layout", () => {
    exposeBodySize("53px");
    new Function(deviceTextSizeScript())();
    expect(document.documentElement).toHaveAttribute("data-device-text-size", "upward");
  });

  it.each(["12px", "16px", "17px"])("keeps the app floor when the device body is %s", (size) => {
    exposeBodySize(size);
    new Function(deviceTextSizeScript())();
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement).not.toHaveAttribute("data-device-text-size");
  });

  it.each([20, 23, 34, 53])("normalizes a %spx device body from 17 to the app's 16", (size) => {
    exposeBodySize(`${size}px`);
    new Function(deviceTextSizeScript())();
    expect(Number.parseFloat(document.documentElement.style.fontSize)).toBeCloseTo(
      (size / 17) * 100,
    );
    expect(document.documentElement.style.fontSize).toMatch(/%$/);
  });

  it("does not compound a larger browser default with a smaller device request", () => {
    exposeBodySize("23px", true, "24px");
    new Function(deviceTextSizeScript())();
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement).not.toHaveAttribute("data-device-text-size");
  });

  it("normalizes to the app baseline without multiplying a larger browser default again", () => {
    exposeBodySize("53px", true, "24px");
    new Function(deviceTextSizeScript())();
    const percentage = Number.parseFloat(document.documentElement.style.fontSize);
    expect((24 * percentage) / 100).toBeCloseTo((53 / 17) * 16);
  });

  it.each(["", "NaN", "0px"])("leaves an unreadable root baseline unchanged: %s", (root) => {
    exposeBodySize("53px", true, root);
    new Function(deviceTextSizeScript())();
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement).not.toHaveAttribute("data-device-text-size");
  });

  it("leaves unsupported platforms exactly as they were", () => {
    exposeBodySize("53px", false);
    const create = vi.spyOn(document, "createElement");
    new Function(deviceTextSizeScript())();
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement).not.toHaveAttribute("data-device-text-size");
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["", "garbage", "NaN", "Infinity", "0px", "-1px"])(
    "ignores an invalid reading: %s",
    (size) => {
      exposeBodySize(size);
      new Function(deviceTextSizeScript())();
      expect(document.documentElement.style.fontSize).toBe("");
      expect(document.documentElement).not.toHaveAttribute("data-device-text-size");
      expect(document.documentElement.querySelector("[data-device-text-probe]")).toBeNull();
    },
  );

  it("does not replace font, layout, viewport, storage or content", () => {
    document.documentElement.style.fontFamily = "serif";
    exposeBodySize("53px");
    const before = document.body.innerHTML;
    new Function(deviceTextSizeScript())();
    expect(document.documentElement.style.fontFamily).toBe("serif");
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector("[data-device-text-probe]")).toBeNull();
  });

  it("cleans up a failed probe and leaves the fallback intact", () => {
    exposeBodySize("53px");
    vi.stubGlobal("getComputedStyle", () => {
      throw new Error("unavailable");
    });
    expect(() => new Function(deviceTextSizeScript())()).not.toThrow();
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement).not.toHaveAttribute("data-device-text-size");
    expect(document.querySelector("[data-device-text-probe]")).toBeNull();
  });

  it("works without CSS APIs and never escapes its inline script", () => {
    vi.stubGlobal("CSS", undefined);
    expect(() => new Function(deviceTextSizeScript())()).not.toThrow();
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement).not.toHaveAttribute("data-device-text-size");
    expect(deviceTextSizeScript()).not.toContain("</");
  });
});
