import { describe, expect, it } from "vitest";
import { AGENCY_CHECKS, PAGE_TEXT_MAX_LENGTH } from "./agency-check";
import { AGENCY_VERIFICATION_PAGES } from "./agency-verification";
import {
  CHECK_REQUEST_TYPE,
  CHECK_RESULT_TYPE,
  ELEARNING_REQUEST_TYPE,
  EXTENSION_FAILURE_REASONS,
  EXTENSION_MARKER_ATTRIBUTE,
  EXTENSION_MESSAGE_SOURCE,
  EXTENSION_READY_EVENT,
  extensionFailureReason,
  PAGE_MESSAGE_SOURCE,
} from "./cert-check-extension";
import { ELEARNING_AGENCIES } from "./elearning-check";

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
      ELEARNING_REQUEST_TYPE,
      RESULT_TYPE: CHECK_RESULT_TYPE,
      PAGE_TEXT_MAX_LENGTH,
    });
  });

  it("reports the manifest's version", () => {
    expect(extension.VERSION).toBe(manifest.version);
  });

  it("gives only reasons the app knows, so a signed-out PADI page says so", async () => {
    const { readFile } = await import("node:fs/promises");
    const worker = await readFile(
      new URL("../../extension/background.js", import.meta.url),
      "utf8",
    );
    const reasons = new Set([...worker.matchAll(/reason: "([a-z_]+)"/g)].map((m) => m[1]));
    expect(reasons).toContain("signed_out");
    for (const reason of reasons) expect(EXTENSION_FAILURE_REASONS).toContain(reason);
  });

  it("reads anything else the extension says as a form it could not fill", () => {
    expect(extensionFailureReason("signed_out")).toBe("signed_out");
    expect(extensionFailureReason("Sign in, then <b>click here</b>")).toBe("fill_failed");
    expect(extensionFailureReason(undefined)).toBe("fill_failed");
  });
});

describe("the extension's agencies", () => {
  const agencies = extension.AGENCIES as Record<string, { url: string; signIn?: boolean }>;

  it("checks exactly the agencies the app offers a check for", () => {
    expect(Object.keys(agencies).sort()).toEqual(Object.keys(AGENCY_CHECKS).sort());
  });

  it("opens the same page the app links to, and may read nothing else", () => {
    for (const [agency, spec] of Object.entries(agencies)) {
      const page = AGENCY_VERIFICATION_PAGES[agency as keyof typeof AGENCY_VERIFICATION_PAGES];
      expect(spec.url).toBe(page?.checkUrl ?? page?.url);
      expect(new URL(spec.url).protocol).toBe("https:");
      expect(new URL(spec.url).search).toBe("");
      const origin = new URL(spec.url).origin;
      expect(manifest.host_permissions).toContain(`${origin}/*`);
    }
  });

  it("asks for no host it does not open", () => {
    const pages = [
      ...Object.values(agencies),
      ...Object.values(extension.ELEARNING as Record<string, { url: string }>),
    ];
    expect(manifest.host_permissions).toHaveLength(
      new Set(pages.map((a) => new URL(a.url).origin)).size,
    );
  });

  it("reads eLearning only for the agencies the app checks it for", () => {
    const elearning = extension.ELEARNING as Record<string, { url: string }>;
    expect(Object.keys(elearning).sort()).toEqual([...ELEARNING_AGENCIES].sort());
    for (const spec of Object.values(elearning)) {
      expect(manifest.host_permissions).toContain(`${new URL(spec.url).origin}/*`);
    }
  });

  it("holds every lookup behind a member sign-in to the signed-in rules, and only those", () => {
    for (const [agency, spec] of Object.entries(agencies)) {
      const page = AGENCY_VERIFICATION_PAGES[agency as keyof typeof AGENCY_VERIFICATION_PAGES];
      expect(spec.signIn === true, agency).toBe(page?.kind === "member_sign_in");
    }
    for (const spec of Object.values(extension.ELEARNING as Record<string, { signIn?: boolean }>)) {
      expect(spec.signIn).toBe(true);
    }
  });

  it("checks PADI's DiveChek on the Pros' Site the eLearning check reads", () => {
    const elearning = extension.ELEARNING as Record<string, { url: string }>;
    expect(new URL(agencies.padi?.url ?? "").origin).toBe(
      new URL(elearning.padi?.url ?? "").origin,
    );
  });

  it("links a staffer to PADI on the host the check signs in to", () => {
    const page = AGENCY_VERIFICATION_PAGES.padi;
    expect(new URL(page?.url ?? "").origin).toBe(new URL(agencies.padi?.url ?? "").origin);
  });

  it("spells the sign-in address rule once, in protocol.js", async () => {
    const { readFile } = await import("node:fs/promises");
    expect(typeof extension.SIGN_IN_PATH).toBe("string");
    for (const file of ["background.js", "fill.js"]) {
      const source = await readFile(new URL(`../../extension/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toContain("sign-?up");
    }
  });

  it("talks only to DiveDay's own staff pages", () => {
    const matches = manifest.content_scripts.flatMap((script) => script.matches);
    expect(matches).toEqual(["https://dive.day/shop/*"]);
  });
});
