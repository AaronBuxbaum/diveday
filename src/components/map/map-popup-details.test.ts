// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createSitePopup } from "./map-markup";
import { loadSitePopupDetails } from "./map-popup-details";

const pin = {
  id: "reef",
  name: "Reef",
  latitude: 1,
  longitude: 2,
  href: "/reef",
  hrefLabel: "Open site",
};
const words = { loading: "Loading details", unavailable: "Details unavailable" };

describe("selected map details", () => {
  it("loads only the selected id and preserves the existing keyboard link", async () => {
    const popup = createSitePopup(pin);
    document.body.append(popup);
    const link = popup.querySelector("a");
    if (!link) throw new Error("Missing preview link");
    link.focus();
    let resolve!: (details: { description: string; details: string[] }) => void;
    const loader = vi.fn(
      () =>
        new Promise<{ description: string; details: string[] }>((done) => {
          resolve = done;
        }),
    );
    const pending = loadSitePopupDetails(popup, pin, loader, words);
    expect(loader).toHaveBeenCalledExactlyOnceWith("reef");
    expect(popup.querySelector('[role="status"]')?.textContent).toBe(words.loading);
    resolve({ description: "<script>not markup</script>", details: ["18 m"] });
    expect(await pending).toBe(true);
    expect(popup.textContent).toContain("18 m");
    expect(popup.querySelector("script")).toBeNull();
    expect(popup.querySelector("a")).toBe(link);
    expect(document.activeElement).toBe(link);
    popup.remove();
  });

  it("leaves the preview available after offline errors and can retry on a later selection", async () => {
    const popup = createSitePopup(pin);
    expect(
      await loadSitePopupDetails(
        popup,
        pin,
        async () => {
          throw new Error("private error");
        },
        words,
      ),
    ).toBe(false);
    expect(popup.textContent).toContain(words.unavailable);
    expect(popup.textContent).not.toContain("private error");
    expect(popup.querySelector("a")?.getAttribute("href")).toBe("/reef");
    expect(
      await loadSitePopupDetails(popup, pin, async () => ({ description: "Recovered" }), words),
    ).toBe(true);
    expect(popup.textContent).toContain("Recovered");
    expect(popup.querySelector('[role="status"]')).toBeNull();
  });

  it("shows the unavailable state for a no-longer-published selection", async () => {
    const popup = createSitePopup(pin);
    expect(await loadSitePopupDetails(popup, pin, async () => null, words)).toBe(false);
    expect(popup.textContent).toContain(words.unavailable);
  });
});
