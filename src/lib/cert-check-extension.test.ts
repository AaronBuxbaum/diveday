import { describe, expect, it } from "vitest";
import { AGENCY_CHECKS, PAGE_TEXT_MAX_LENGTH } from "./agency-check";
import { AGENCY_VERIFICATION_PAGES } from "./agency-verification";
import {
  CHECK_REQUEST_TYPE,
  CHECK_RESULT_TYPE,
  EXTENSION_MARKER_ATTRIBUTE,
  EXTENSION_MESSAGE_SOURCE,
  EXTENSION_READY_EVENT,
  PAGE_MESSAGE_SOURCE,
} from "./cert-check-extension";

/**
 * The extension (`extension/`) is plain scripts the browser loads as they are,
 * so it keeps its own copy of the wire format and the agency addresses. These
 * hold the two copies together.
 */
/** The extension's scripts are classic scripts, not modules: loading one sets its globals. */
async function loadExtensionScript(file: string): Promise<void> {
  await import(/* @vite-ignore */ new URL(`../../extension/${file}`, import.meta.url).href);
}
await loadExtensionScript("protocol.js");
await loadExtensionScript("agencies.js");
const extension = (globalThis as unknown as { DiveDayCertCheck: Record<string, unknown> })
  .DiveDayCertCheck;
const manifest = (await import("../../extension/manifest.json")).default;

describe("the extension's copy of the protocol", () => {
  it("names every message and marker the way the app does", () => {
    expect(extension).toMatchObject({
      MARKER_ATTRIBUTE: EXTENSION_MARKER_ATTRIBUTE,
      READY_EVENT: EXTENSION_READY_EVENT,
      PAGE_SOURCE: PAGE_MESSAGE_SOURCE,
      EXTENSION_SOURCE: EXTENSION_MESSAGE_SOURCE,
      REQUEST_TYPE: CHECK_REQUEST_TYPE,
      RESULT_TYPE: CHECK_RESULT_TYPE,
      PAGE_TEXT_MAX_LENGTH,
    });
  });

  it("reports the manifest's version", () => {
    expect(extension.VERSION).toBe(manifest.version);
  });
});

describe("the extension's agencies", () => {
  const agencies = extension.AGENCIES as Record<string, { url: string }>;

  it("checks exactly the agencies the app offers a check for", () => {
    expect(Object.keys(agencies).sort()).toEqual(Object.keys(AGENCY_CHECKS).sort());
  });

  it("opens the same page the app links to, and may read nothing else", () => {
    for (const [agency, spec] of Object.entries(agencies)) {
      const page = AGENCY_VERIFICATION_PAGES[agency as keyof typeof AGENCY_VERIFICATION_PAGES];
      expect(spec.url).toBe(page?.url);
      const origin = new URL(spec.url).origin;
      expect(manifest.host_permissions).toContain(`${origin}/*`);
    }
    expect(manifest.host_permissions).toHaveLength(
      new Set(Object.values(agencies).map((a) => new URL(a.url).origin)).size,
    );
  });

  it("talks only to DiveDay's own pages", () => {
    const matches = manifest.content_scripts.flatMap((script) => script.matches);
    expect(matches).toEqual(["https://dive.day/*", "http://localhost/*", "http://127.0.0.1/*"]);
  });
});
