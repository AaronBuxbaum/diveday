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

  it("loads its service worker the way Chrome does, every script into one global scope", async () => {
    // `importScripts` runs each file as a classic script in the worker's own
    // global scope, so a top-level `const` in background.js and a function of
    // the same name in fill.js collide, the import throws, and the worker never
    // listens. Loaded one by one, as above, they never meet.
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const source = (file: string) =>
      readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8");
    const listeners: unknown[] = [];
    const worker: Record<string, unknown> = {
      chrome: {
        runtime: { id: "test", onMessage: { addListener: (fn: unknown) => listeners.push(fn) } },
      },
      importScripts: (...files: string[]) => {
        for (const file of files) vm.runInContext(source(file), worker, { filename: file });
      },
    };
    vm.createContext(worker);
    vm.runInContext("globalThis.self = globalThis;", worker);
    expect(() =>
      vm.runInContext(source("background.js"), worker, { filename: "background.js" }),
    ).not.toThrow();
    expect(listeners).toHaveLength(1);
  });

  it("reads a PADI tab sent between PADI's hosts as signed in, and anywhere else as signed out", async () => {
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const source = (file: string) =>
      readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8");
    let at = "";
    const worker: Record<string, unknown> = {
      chrome: {
        runtime: { id: "test", onMessage: { addListener: () => {} } },
        tabs: { get: async () => ({ url: at }) },
      },
      URL,
      importScripts: (...files: string[]) => {
        for (const file of files) vm.runInContext(source(file), worker, { filename: file });
      },
    };
    vm.createContext(worker);
    vm.runInContext(source("background.js"), worker, { filename: "background.js" });
    const landedOnSignIn = worker.landedOnSignIn as (
      tabId: number,
      spec: unknown,
    ) => Promise<boolean>;
    const padi = (worker.DiveDayCertCheck as { AGENCIES: Record<string, unknown> }).AGENCIES.padi;
    const cases: [string, boolean][] = [
      ["https://pro.padi.com/divechek", false],
      ["https://pros.padi.com/divechek", false],
      ["https://pro.padi.com/me/dashboard", false],
      ["https://pros.padi.com/sign-in?return=%2Fdivechek", true],
      ["https://login.padi.com/sign-in", true],
      ["https://pro.padi.com.example.net/divechek", true],
      ["", true],
    ];
    for (const [url, signedOut] of cases) {
      at = url;
      expect(await landedOnSignIn(1, padi), url).toBe(signedOut);
    }
  });

  /**
   * The service worker's whole check, on a stand-in Chrome: the tab's address
   * at each step, and what each script run in it answers.
   */
  async function workerCheck(options: {
    agency: string;
    /** The tab's address before the form is filled, and after. */
    before: string;
    after: string;
    /** What the page asks once searched: a sign-in, or nothing. */
    asksToSignInAfter?: boolean;
    elearning?: boolean;
  }) {
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const source = (file: string) =>
      readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8");
    let filled = false;
    const ran: string[] = [];
    const worker: Record<string, unknown> = {
      chrome: {
        runtime: { id: "test", onMessage: { addListener: () => {} } },
        tabs: {
          create: async () => ({ id: 1 }),
          get: async () => ({ url: filled ? options.after : options.before, status: "complete" }),
          remove: async () => {},
          onUpdated: { addListener: () => {}, removeListener: () => {} },
        },
        scripting: {
          executeScript: async ({ func }: { func: { name: string } }) => {
            ran.push(func.name);
            if (func.name === "fillAgencyForm") {
              filled = true;
              return [{ result: { ok: true } }];
            }
            if (func.name === "pageAsksToSignIn") {
              return [{ result: filled && options.asksToSignInAfter === true }];
            }
            return [{ result: filled ? "Lena Ortiz\nOpen Water Diver" : "Search form" }];
          },
        },
      },
      URL,
      setTimeout: (fn: () => void) => setImmediate(fn),
      clearTimeout: () => {},
      importScripts: (...files: string[]) => {
        for (const file of files) vm.runInContext(source(file), worker, { filename: file });
      },
    };
    vm.createContext(worker);
    vm.runInContext(source("background.js"), worker, { filename: "background.js" });
    const pages = (
      worker.DiveDayCertCheck as {
        AGENCIES: Record<string, unknown>;
        ELEARNING: Record<string, unknown>;
      }
    )[options.elearning ? "ELEARNING" : "AGENCIES"];
    const check = worker.check as (
      query: unknown,
      pages: unknown,
    ) => Promise<{ ok: boolean; reason?: string; pageText?: string }>;
    const reply = await check(
      {
        agency: options.agency,
        firstName: "Lena",
        lastName: "Ortiz",
        birthDate: "1990-04-12",
        cardNumber: "123",
      },
      pages,
    );
    return { reply, ran };
  }

  /** Security review R4-2: a public lookup sent to PADI's signed-in site is never read. */
  it("never fills or reads a public lookup's tab once it is on another site", async () => {
    const { reply, ran } = await workerCheck({
      agency: "ssi",
      before: "https://pro.padi.com/me/dashboard",
      after: "https://pro.padi.com/me/dashboard",
    });
    expect(reply).toEqual({ ok: false, reason: "fill_failed" });
    expect(ran).not.toContain("fillAgencyForm");
  });

  it("hands back nothing from a public lookup sent to another site by its search", async () => {
    const { reply } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://pro.padi.com/me/dashboard",
    });
    expect(reply).toEqual({ ok: false, reason: "fill_failed" });
  });

  it("hands back a public lookup's page when it stays on the agency's site", async () => {
    const { reply } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check?diver_name=Lena",
    });
    expect(reply).toMatchObject({ ok: true, pageText: "Lena Ortiz\nOpen Water Diver" });
  });

  /** Domain review R4 (adversarial) 5: a search answered with a sign-in is a lapsed session. */
  it("reads DiveChek answering its search with a sign-in as signed out, never a result", async () => {
    const { reply } = await workerCheck({
      agency: "padi",
      before: "https://pros.padi.com/divechek",
      after: "https://pros.padi.com/divechek?first_name=Lena",
      asksToSignInAfter: true,
    });
    expect(reply).toEqual({ ok: false, reason: "signed_out" });
  });

  it("reads DiveChek's search sent to a sign-in address as signed out", async () => {
    const { reply } = await workerCheck({
      agency: "padi",
      before: "https://pro.padi.com/divechek",
      after: "https://pros.padi.com/sign-in?return=%2Fdivechek",
    });
    expect(reply).toEqual({ ok: false, reason: "signed_out" });
  });

  it("hands back DiveChek's result when the staffer stays signed in", async () => {
    const { reply } = await workerCheck({
      agency: "padi",
      before: "https://pro.padi.com/divechek",
      after: "https://pros.padi.com/divechek?first_name=Lena",
    });
    expect(reply).toMatchObject({ ok: true, pageText: "Lena Ortiz\nOpen Water Diver" });
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

  it("asks for no host it does not open or may be sent to", () => {
    const pages = [
      ...Object.values(agencies),
      ...Object.values(extension.ELEARNING as Record<string, { url: string; origins?: string[] }>),
    ] as { url: string; origins?: string[] }[];
    const origins = new Set(pages.flatMap((a) => [new URL(a.url).origin, ...(a.origins ?? [])]));
    expect(manifest.host_permissions.slice().sort()).toEqual(
      [...origins].map((origin) => `${origin}/*`).sort(),
    );
  });

  it("opens PADI on pro.padi.com, the host PADI's own pages send pros to", () => {
    const elearning = extension.ELEARNING as Record<string, { url: string }>;
    expect(new URL(agencies.padi?.url ?? "").origin).toBe("https://pro.padi.com");
    expect(new URL(elearning.padi?.url ?? "").origin).toBe("https://pro.padi.com");
    expect(new URL(AGENCY_VERIFICATION_PAGES.padi?.url ?? "").origin).toBe("https://pro.padi.com");
  });

  it("reads PADI on both its hosts, so a staffer sent from one to the other is still signed in", () => {
    const padi = [agencies.padi, (extension.ELEARNING as Record<string, { url: string }>).padi] as (
      | { url: string; origins?: string[] }
      | undefined
    )[];
    for (const spec of padi) {
      expect(spec?.origins).toEqual(["https://pro.padi.com", "https://pros.padi.com"]);
    }
    expect(manifest.host_permissions).toContain("https://pro.padi.com/*");
    expect(manifest.host_permissions).toContain("https://pros.padi.com/*");
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
