// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASS_ICONS, WWDR_CERTIFICATE } from "./bundled-assets";

describe("public bundled Wallet assets", () => {
  it("contains the public Apple intermediate and every original icon in the tracked module", () => {
    expect(WWDR_CERTIFICATE).toEqual(
      readFileSync(new URL("./assets/AppleWWDRCAG4.crt", import.meta.url)),
    );
    for (const [name, bytes] of Object.entries(PASS_ICONS))
      expect(bytes).toEqual(readFileSync(new URL(`./assets/${name}`, import.meta.url)));
  });
});
