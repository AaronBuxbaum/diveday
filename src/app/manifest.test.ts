import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

  it("points every icon at a file that exists, at the size it advertises", () => {
    // The whole failure mode this file exists for is a manifest that *claims*
    // sizes nothing renders. The icons were `ImageResponse` routes until issue
    // #1361 and these two tests compared the manifest against the route's own
    // size list; now the artwork is four committed PNGs, so the manifest is
    // compared against the bytes on disk instead — which is the stronger claim
    // the old pair was reaching for.
    const nonMaskable = icons.filter((icon) => icon.purpose !== "maskable");
    expect(nonMaskable.length).toBe(4);

    for (const icon of nonMaskable) {
      const src = String(icon.src);
      // `icon.png` and `apple-icon.png` are Next's static metadata convention
      // and live beside this file; the other two are plain `public/` files.
      const file =
        src === "/icon.png" || src === "/apple-icon.png" ? `src/app${src}` : `public${src}`;
      const png = readFileSync(path.join(process.cwd(), file));
      // The PNG signature, then IHDR's width and height as big-endian uint32s.
      // Read directly rather than pulling an image library into a unit test.
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });
});
