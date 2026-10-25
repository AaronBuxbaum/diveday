import { describe, expect, it } from "vitest";
import { AGENCY_CHECKS, PAGE_TEXT_MAX_LENGTH } from "./agency-check";
import { AGENCY_VERIFICATION_PAGES } from "./agency-verification";
import {
  CHECK_REQUEST_TYPE,
  CHECK_RESULT_TYPE,
  DRY_RUN_REQUEST_TYPE,
  dryRunPassed,
  ELEARNING_REQUEST_TYPE,
  EXTENSION_FAILURE_REASONS,
  EXTENSION_MARKER_ATTRIBUTE,
  EXTENSION_MESSAGE_SOURCE,
  EXTENSION_READY_EVENT,
  extensionChecks,
  extensionFailure,
  extensionFailureReason,
  extensionPresence,
  HELLO_REQUEST_TYPE,
  MIN_EXTENSION_VERSION,
  PADI_SESSION_REQUEST_TYPE,
  PAGE_MESSAGE_SOURCE,
  parseExtensionDryRun,
  parseExtensionHello,
  parsePadiSession,
  versionAtLeast,
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
      HELLO_REQUEST_TYPE,
      DRY_RUN_REQUEST_TYPE,
      PADI_SESSION_REQUEST_TYPE,
      RESULT_TYPE: CHECK_RESULT_TYPE,
      PAGE_TEXT_MAX_LENGTH,
    });
  });

  it("names an icon at each size the stores ask for, each a PNG of that size", async () => {
    const { readFileSync } = await import("node:fs");
    const icons = (manifest as { icons?: Record<string, string> }).icons ?? {};
    expect(Object.keys(icons).sort()).toEqual(["128", "16", "48"]);
    for (const [size, file] of Object.entries(icons)) {
      const png = readFileSync(new URL(`../../extension/${file}`, import.meta.url));
      expect(png.subarray(1, 4).toString(), file).toBe("PNG");
      expect(png.readUInt32BE(16), file).toBe(Number(size));
      expect(png.readUInt32BE(20), file).toBe(Number(size));
    }
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
    const reasons = new Set(
      [...worker.matchAll(/(?:reason: |failed\()"([a-z_]+)"/g)].map((m) => m[1]),
    );
    expect(reasons).toContain("signed_out");
    expect(reasons).toContain("captcha");
    expect(reasons).toContain("page_changed");
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
    /** What the filler answers, by try (from 0); a fill that worked by default. */
    fill?:
      | { ok: boolean; missing?: string[] }
      | ((attempt: number) => { ok: boolean; missing?: string[] });
    /** The page's shape (shape.js), before the form is filled and after. */
    shape?: (filled: boolean) => object | null;
    /** The page's text once searched. */
    textAfter?: string;
  }) {
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const source = (file: string) =>
      readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8");
    let filled = false;
    let fills = 0;
    // The worker's clock, moved only by its own waits, so a wait to the
    // deadline takes no time here.
    let clock = 1_000_000;
    const ran: string[] = [];
    const worker: Record<string, unknown> = {
      chrome: {
        runtime: { id: "test", onMessage: { addListener: () => {} } },
        tabs: {
          create: async () => ({ id: 1, status: "loading" }),
          get: async () => ({ url: filled ? options.after : options.before, status: "complete" }),
          remove: async () => {},
          onUpdated: { addListener: () => {}, removeListener: () => {} },
        },
        scripting: {
          executeScript: async ({ func }: { func: { name: string } }) => {
            ran.push(func.name);
            if (func.name === "fillAgencyForm") {
              const answer =
                typeof options.fill === "function"
                  ? options.fill(fills)
                  : (options.fill ?? { ok: true });
              fills += 1;
              filled = answer.ok;
              return [{ result: answer }];
            }
            if (func.name === "describePageShape") {
              return [{ result: options.shape ? options.shape(filled) : null }];
            }
            if (func.name === "pageAsksToSignIn") {
              return [{ result: filled && options.asksToSignInAfter === true }];
            }
            return [
              {
                result: filled
                  ? (options.textAfter ?? "Lena Ortiz\nOpen Water Diver")
                  : "Search form",
              },
            ];
          },
        },
      },
      URL,
      Date: { now: () => clock },
      setTimeout: (fn: () => void, ms = 0) => {
        const timer = { cleared: false };
        setImmediate(() => {
          if (timer.cleared) return;
          clock += ms;
          fn();
        });
        return timer;
      },
      clearTimeout: (timer?: { cleared: boolean }) => {
        if (timer) timer.cleared = true;
      },
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
    return {
      reply,
      ran,
      fills: () => fills,
      elapsed: () => clock - 1_000_000,
      phases: () => worker.DiveDayCheckPhases as [number, string][],
      record: worker.phase as (name: string) => void,
    };
  }

  /** #2878: where a stalled lookup stopped, by fixed phase names and times, and nothing of the diver. */
  it("records each lookup's phases by name and time only, and keeps a bounded number", async () => {
    const { phases, record } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check?diver_name=Lena",
    });
    const names = phases().map(([, name]) => name);
    expect(names.slice(0, 8)).toEqual([
      "check:start",
      "tab:created:loading",
      "tab:get:complete",
      "tab:loaded",
      "run:readAgencyPage",
      "ran:readAgencyPage",
      "run:fillAgencyForm",
      "ran:fillAgencyForm",
    ]);
    expect(names).toContain("fill:ok");
    for (const [at, name] of phases()) {
      expect(typeof at).toBe("number");
      expect(name).toMatch(/^[a-z]+:[a-zA-Z:_-]+$/);
      expect(name).not.toMatch(/Lena|Ortiz|123|1990|divessi/);
    }
    // A worker that lives through many lookups keeps only the latest phases.
    for (let index = 0; index < 500; index += 1) record(`run:readAgencyPage`);
    expect(phases()).toHaveLength(200);
  });

  /** Security review R4-2: a public lookup sent to PADI's signed-in site is never read. */
  it("never fills or reads a public lookup's tab once it is on another site", async () => {
    const { reply, ran } = await workerCheck({
      agency: "ssi",
      before: "https://pro.padi.com/me/dashboard",
      after: "https://pro.padi.com/me/dashboard",
    });
    expect(reply).toEqual({ ok: false, reason: "fill_failed" });
    expect(ran).not.toContain("fillAgencyForm");
    // Not even its shape is read.
    expect(ran).not.toContain("describePageShape");
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

  const FORM_SHAPE = {
    path: "/online diver check",
    title: "online diver check",
    headings: [],
    boxes: [{ tag: "input", type: "text", words: "_" }],
    buttons: ["search"],
    forms: 1,
    frames: 0,
    password: false,
    captcha: false,
  };

  /** Domain review R7 (adversarial) 6: the filler says when the lookup's own form asks. */
  it("types nothing on a lookup whose form asks whether the staffer is human, and says so with its shape", async () => {
    const shape = { ...FORM_SHAPE, captcha: true };
    const { reply, fills } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check",
      fill: { ok: false, missing: ["captcha"] },
      shape: () => shape,
    });
    expect(reply).toEqual({ ok: false, reason: "captcha", pageShape: shape });
    expect(fills()).toBe(1);
  });

  it("fills a lookup though a captcha is elsewhere on its page", async () => {
    const { reply, ran } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check?diver_name=Lena",
      shape: () => ({ ...FORM_SHAPE, captcha: true }),
    });
    expect(ran).toContain("fillAgencyForm");
    expect(reply).toMatchObject({ ok: true, pageText: "Lena Ortiz\nOpen Water Diver" });
  });

  it("reads a lookup page with no box where the lookup expects one as a changed page, with its shape", async () => {
    const { reply, ran } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check",
      fill: { ok: false, missing: ["name"] },
      shape: () => FORM_SHAPE,
    });
    expect(reply).toEqual({ ok: false, reason: "page_changed", pageShape: FORM_SHAPE });
    expect(ran.filter((name) => name === "fillAgencyForm").length).toBeGreaterThan(0);
  });

  /** Domain review R7 (adversarial) 7: a page that has not drawn its form yet has not changed. */
  it("waits for a page with no box yet, and fills it once its form shows", async () => {
    const { reply, fills } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check?diver_name=Lena",
      fill: (attempt) => (attempt < 12 ? { ok: false, missing: ["form"] } : { ok: true }),
      shape: () => ({ ...FORM_SHAPE, boxes: [] }),
    });
    expect(fills()).toBe(13);
    expect(reply).toMatchObject({ ok: true });
  });

  it("never reads a page that shows no box before the deadline as changed", async () => {
    const empty = { ...FORM_SHAPE, boxes: [], buttons: [], forms: 0 };
    const { reply, elapsed } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check",
      fill: { ok: false, missing: ["form"] },
      shape: () => empty,
    });
    expect(reply).toEqual({ ok: false, reason: "timeout", pageShape: empty });
    expect(elapsed()).toBeGreaterThanOrEqual(35_000);
    const challenge = { ...empty, captcha: true };
    const blocked = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check",
      fill: { ok: false, missing: ["form"] },
      shape: () => challenge,
    });
    expect(blocked.reply).toEqual({ ok: false, reason: "captcha", pageShape: challenge });
  });

  it("hands back no text from an answer asking whether the staffer is human", async () => {
    const answered = { ...FORM_SHAPE, captcha: true };
    const { reply } = await workerCheck({
      agency: "ssi",
      before: "https://my.divessi.com/online_diver_check",
      after: "https://my.divessi.com/online_diver_check?diver_name=Lena",
      shape: (filled) => (filled ? answered : FORM_SHAPE),
      textAfter: "Online Diver Check\nPlease verify you are human",
    });
    expect(reply).toEqual({ ok: false, reason: "captcha", pageShape: answered });
  });

  /** Domain review R7 (adversarial) 6: a captcha beside an answer does not hide the answer. */
  it("hands back an answer that names the diver or finds nobody, captcha or not", async () => {
    for (const textAfter of ["Lena Ortiz\nOpen Water Diver", "No results found"]) {
      const { reply } = await workerCheck({
        agency: "ssi",
        before: "https://my.divessi.com/online_diver_check",
        after: "https://my.divessi.com/online_diver_check?diver_name=Lena",
        shape: (filled) => (filled ? { ...FORM_SHAPE, captcha: true } : FORM_SHAPE),
        textAfter,
      });
      expect(reply, textAfter).toMatchObject({ ok: true, pageText: textAfter });
    }
  });

  it("answers hello with its version and the agencies it checks", async () => {
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const source = (file: string) =>
      readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8");
    let listener:
      | ((message: unknown, sender: unknown, reply: (r: unknown) => void) => unknown)
      | null = null;
    const worker: Record<string, unknown> = {
      chrome: {
        runtime: {
          id: "test",
          onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
          getURL: (path: string) => `chrome-extension://test/${path}`,
        },
      },
      URL,
      importScripts: (...files: string[]) => {
        for (const file of files) vm.runInContext(source(file), worker, { filename: file });
      },
    };
    vm.createContext(worker);
    vm.runInContext(source("background.js"), worker, { filename: "background.js" });
    const answers: unknown[] = [];
    const ask = (url: string) =>
      listener?.(
        { type: HELLO_REQUEST_TYPE },
        { id: "test", tab: { id: 1 }, frameId: 0, url },
        (answer) => answers.push(answer),
      );
    ask("https://dive.day/shop/blue-mantis/settings");
    // Not from a page outside DiveDay's staff pages.
    ask("https://example.com/shop/x");
    expect(answers).toEqual([
      {
        ok: true,
        version: manifest.version,
        agencies: Object.keys(AGENCY_CHECKS),
        elearning: [...ELEARNING_AGENCIES],
      },
    ]);
  });

  it("says whether a PADI Pros' Site tab is signed in, opening nothing and typing nothing", async () => {
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const source = (file: string) =>
      readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8");
    let tabs: { id: number; url?: string }[] = [];
    let asks = true;
    let allowed = true;
    const ran: string[] = [];
    const worker: Record<string, unknown> = {
      chrome: {
        runtime: { id: "test", onMessage: { addListener: () => {} } },
        permissions: {
          contains: async ({ origins }: { origins: string[] }) => {
            expect(origins).toEqual(["https://pro.padi.com/*", "https://pros.padi.com/*"]);
            return allowed;
          },
        },
        tabs: {
          query: async ({ url }: { url: string[] }) => {
            expect(url).toEqual(["https://pro.padi.com/*", "https://pros.padi.com/*"]);
            return tabs;
          },
          create: async () => {
            throw new Error("opened a tab");
          },
        },
        scripting: {
          executeScript: async ({ func }: { func: { name: string } }) => {
            ran.push(func.name);
            return [{ result: asks }];
          },
        },
      },
      URL,
      importScripts: (...files: string[]) => {
        for (const file of files) vm.runInContext(source(file), worker, { filename: file });
      },
    };
    vm.createContext(worker);
    vm.runInContext(source("background.js"), worker, { filename: "background.js" });
    const padiSession = worker.padiSession as () => Promise<unknown>;
    expect(await padiSession()).toEqual({ ok: true, padi: "no_tab" });
    tabs = [{ id: 1, url: "https://pros.padi.com/sign-in?return=%2F" }];
    expect(await padiSession()).toEqual({ ok: true, padi: "signed_out" });
    expect(ran).toEqual([]);
    tabs = [{ id: 2, url: "https://pro.padi.com/me/dashboard" }];
    expect(await padiSession()).toEqual({ ok: true, padi: "signed_out" });
    asks = false;
    expect(await padiSession()).toEqual({ ok: true, padi: "signed_in" });
    expect(new Set(ran)).toEqual(new Set(["pageAsksToSignIn"]));
    // Domain review R7 (adversarial) 5: a browser that withheld PADI's hosts says so.
    allowed = false;
    expect(await padiSession()).toEqual({ ok: true, padi: "no_access" });
  });

  /** Domain review R7 (adversarial) 5: a dry run fails where the agency's own site is withheld. */
  it("says with each dry run whether this browser lets the extension on that agency's site", async () => {
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const source = (file: string) =>
      readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8");
    const withheld = new Set(["https://www.naui.org/*"]);
    const asked: string[][] = [];
    const worker: Record<string, unknown> = {
      chrome: {
        runtime: {
          id: "test",
          onMessage: { addListener: () => {} },
          getURL: (path: string) => `chrome-extension://test/${path}`,
        },
        permissions: {
          contains: async ({ origins }: { origins: string[] }) => {
            asked.push(origins);
            return origins.every((origin) => !withheld.has(origin));
          },
        },
        tabs: {
          create: async () => {
            // The sample page answers at once, as a filled form would.
            (worker.answerDryRun as (tabId: number, result: unknown) => void)(
              7,
              (worker.dryRunResult as (result: unknown) => unknown)({
                filled: true,
                typed: true,
                submitted: true,
                missing: [],
              }),
            );
            return { id: 7 };
          },
          remove: async () => {},
        },
      },
      URL,
      setTimeout: () => 0,
      clearTimeout: () => {},
      importScripts: (...files: string[]) => {
        for (const file of files) vm.runInContext(source(file), worker, { filename: file });
      },
    };
    vm.createContext(worker);
    vm.runInContext(source("background.js"), worker, { filename: "background.js" });
    const dryRun = worker.dryRun as (agency: string) => Promise<Record<string, unknown>>;
    expect(await dryRun("ssi")).toMatchObject({ ok: true, filled: true, hostAccess: true });
    expect(await dryRun("naui")).toMatchObject({ ok: true, filled: true, hostAccess: false });
    expect(asked).toEqual([["https://my.divessi.com/*"], ["https://www.naui.org/*"]]);
    expect(dryRunPassed(parseExtensionDryRun(await dryRun("naui")))).toBe(false);
    expect(dryRunPassed(parseExtensionDryRun(await dryRun("ssi")))).toBe(true);
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

describe("the extension's version", () => {
  it("compares versions part by part, never as text", () => {
    expect(versionAtLeast("1.5.0", "1.5.0")).toBe(true);
    expect(versionAtLeast("1.10.0", "1.5.0")).toBe(true);
    expect(versionAtLeast("2.0.0", "1.5.0")).toBe(true);
    expect(versionAtLeast("1.4.9", "1.5.0")).toBe(false);
    expect(versionAtLeast("1.5", "1.5.0")).toBe(false);
    expect(versionAtLeast("1.5.0-beta", "1.5.0")).toBe(false);
    expect(versionAtLeast(null, "1.5.0")).toBe(false);
  });

  it("is a copy the app talks to only at or above the minimum, which this copy meets", () => {
    expect(extensionPresence(null)).toEqual({ state: "absent" });
    expect(extensionPresence("1.2.0")).toEqual({ state: "outdated", version: "1.2.0" });
    expect(extensionPresence("<b>9</b>")).toEqual({ state: "outdated", version: "<b>9</b>" });
    expect(extensionPresence(MIN_EXTENSION_VERSION)).toEqual({
      state: "current",
      version: MIN_EXTENSION_VERSION,
    });
    expect(versionAtLeast(manifest.version, MIN_EXTENSION_VERSION)).toBe(true);
  });

  it("offers an agency only when a current copy says it checks it", () => {
    const hello = parseExtensionHello({
      ok: true,
      version: manifest.version,
      agencies: ["ssi", "padi"],
      elearning: ["padi"],
    });
    expect(extensionChecks(hello, "ssi")).toBe(true);
    expect(extensionChecks(hello, "naui")).toBe(false);
    expect(extensionChecks(hello && { ...hello, version: "1.4.0" }, "ssi")).toBe(false);
    expect(extensionChecks(null, "ssi")).toBe(false);
    expect(parseExtensionHello({ ok: true, version: "1.5.0", agencies: ["<script>"] })).toBeNull();
    expect(parseExtensionHello({ ok: true, version: "x", agencies: [], elearning: [] })).toBeNull();
  });
});

describe("what a failed check carries back", () => {
  const shape = {
    path: "/divechek",
    title: "",
    headings: [],
    boxes: [],
    buttons: ["search"],
    forms: 1,
    frames: 0,
    password: false,
    captcha: true,
  };

  it("keeps a reason it knows and a shape that parses, and drops anything else", () => {
    expect(extensionFailure({ reason: "captcha", pageShape: shape })).toEqual({
      ok: false,
      reason: "captcha",
      pageShape: shape,
    });
    expect(
      extensionFailure({ reason: "page_changed", pageShape: { ...shape, title: "Ada" } }),
    ).toEqual({ ok: false, reason: "page_changed" });
    expect(extensionFailure({ reason: "Ada Lovelace", pageText: "Ada" })).toEqual({
      ok: false,
      reason: "fill_failed",
    });
  });

  it("reads a dry run as passed only when every box was found, typed and sent", () => {
    const run = (fields: Record<string, unknown>) =>
      parseExtensionDryRun({
        ok: true,
        filled: true,
        typed: true,
        submitted: true,
        hostAccess: true,
        ...fields,
      });
    expect(dryRunPassed(run({}))).toBe(true);
    expect(dryRunPassed(run({ hostAccess: false }))).toBe(false);
    expect(dryRunPassed(run({ hostAccess: undefined }))).toBe(false);
    expect(dryRunPassed(run({ typed: false }))).toBe(false);
    expect(dryRunPassed(run({ submitted: "yes" }))).toBe(false);
    expect(dryRunPassed(parseExtensionDryRun({ ok: false, reason: "timeout" }))).toBe(false);
    expect(run({ missing: ["name", "<b>", 3] })).toMatchObject({ missing: ["name"] });
    expect(parsePadiSession({ ok: true, padi: "signed_in" })).toBe("signed_in");
    expect(parsePadiSession({ ok: true, padi: "no_access" })).toBe("no_access");
    expect(parsePadiSession({ ok: true, padi: "Ada" })).toBeNull();
  });
});
