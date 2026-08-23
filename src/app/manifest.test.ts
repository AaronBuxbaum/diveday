import { describe, expect, it } from "vitest";
import { generateImageMetadata } from "./icon";
import manifest from "./manifest";

/**
 * **The install criteria, as assertions.**
 *
 * DiveDay shipped a web app manifest whose stated purpose is "lets a crew
 * member install the roll-call manifest to a phone's home screen" and which
 * declared a 32px icon and a 180px one. Chrome will not offer to install an app
 * without an icon of at least 192×192 — it never fires `beforeinstallprompt` —
 * so on Android the app could not be installed at all, and nothing said so: the
 * manifest fetched fine, every test passed, and there is no Lighthouse run in
 * CI (issue #794).
 *
 * These are the rules a browser applies, written down where a diff can see
 * them. They are cheap and they are the only thing standing between here and
 * that state returning.
 */
describe("the web app manifest", () => {
  const icons = manifest().icons ?? [];

  it("declares an icon Chrome will accept for installation", () => {
    // ≥192 in both dimensions, `any` purpose (a maskable-only icon does not
    // satisfy the criterion — Chrome wants one it can show unmodified).
    const installable = icons.filter(
      (icon) =>
        icon.purpose !== "maskable" &&
        (icon.sizes ?? "")
          .split(" ")
          .some((pair) => pair.split("x").every((side) => Number(side) >= 192)),
    );
    expect(installable.length).toBeGreaterThan(0);
  });

  it("declares the 512 the splash screen is drawn from", () => {
    expect(icons.some((icon) => (icon.sizes ?? "").split(" ").includes("512x512"))).toBe(true);
  });

  it("declares a maskable icon, so Android does not letterbox the mark", () => {
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("opens somewhere useful to somebody who has installed it", () => {
    // Not "/", which is the B2B marketing homepage — "Run the whole dive day",
    // "Start a trial". `/shop` is an existing entry point: `auth.config.ts`
    // redirects a signed-in staff member from it to their own shop and bounces
    // anyone else to sign-in.
    expect(manifest().start_url).toBe("/shop");
    expect(manifest().start_url).not.toBe("/");
  });

  it("points every icon at a route that generates it", () => {
    // The whole failure mode this file exists for is a manifest that *claims*
    // sizes nothing renders. `icon.tsx` generates its sizes from one list, so
    // this compares the two rather than trusting either.
    const generated = new Set(generateImageMetadata().map((image) => `/icon/${image.id}`));
    const fromIconRoute = icons
      .map((icon) => String(icon.src))
      .filter((src) => src.startsWith("/icon/"));
    expect(fromIconRoute.length).toBeGreaterThan(0);
    expect(fromIconRoute.filter((src) => !generated.has(src))).toEqual([]);
  });

  it("asks each icon route for the size it advertises", () => {
    for (const image of generateImageMetadata()) {
      const declared = icons.find((icon) => String(icon.src) === `/icon/${image.id}`);
      if (!declared) continue;
      expect(declared.sizes).toBe(`${image.size.width}x${image.size.height}`);
    }
  });
});
