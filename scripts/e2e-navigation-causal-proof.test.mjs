import { createHash } from "node:crypto";
import { linkSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  atomicWrite,
  CAUSAL_TEST,
  classifyCausalRed,
  FIX_ADDITIONS,
  instrumentScrollRouter,
  removeCausalFix,
  restoreOriginals,
} from "./e2e-navigation-causal-proof.mjs";

const hash = (source) => createHash("sha256").update(source).digest("hex");
const geometry = {
  padding: "64px",
  height: 900,
  viewport: 800,
  mains: [{ top: -24, height: 1000 }],
  chrome: [{ height: 64 }],
  headings: [{ top: 1 }],
};
function timeline(repeat) {
  return {
    repeat,
    events: [
      {
        kind: "click",
        url: "/shop/blue-mantis/schedule/board",
        y: 157,
        detail: { destination: "/shop/blue-mantis/trips/one" },
      },
      { kind: "handler", ref: 1, detail: { pending: true } },
      { kind: "fragment-rects", target: 2, detail: { rects: [{ top: 64 }] } },
      { kind: "fragment-decision", target: 2, detail: { state: 1 } },
      {
        kind: "consume",
        ref: 1,
        target: 2,
        url: "/shop/blue-mantis/trips/one",
        y: 100,
        detail: { initialTargetState: 1, pending: true },
        geometry,
      },
      { kind: "scroll", url: "/shop/blue-mantis/trips/one", y: 157 },
      { kind: "final", url: "/shop/blue-mantis/trips/one", y: 157, geometry },
    ],
  };
}
function report() {
  return {
    errors: [],
    suites: [
      {
        specs: [
          {
            title: CAUSAL_TEST,
            tests: [0, 1, 2].map((repeat) => ({
              projectName: "chromium",
              expectedStatus: "passed",
              status: "unexpected",
              results: [
                {
                  status: "failed",
                  retry: 0,
                  errors: [
                    {
                      message:
                        "Error: the departure opened partway down itself\nexpect(received).toBeLessThanOrEqual(expected)\nExpected: <= 69\nReceived:    157",
                    },
                  ],
                  attachments: [
                    { name: "trace" },
                    { name: "navigation-scroll-4183", body: timeline(repeat) },
                  ],
                },
              ],
            })),
          },
        ],
      },
    ],
  };
}
const classify = (input, code = 1) =>
  classifyCausalRed(input, code, (attachment) => attachment.body);

describe("exact #4201 runtime delta", () => {
  it("replaces a hardlink without mutating the store inode and preserves its exact mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "nav4183-atomic-"));
    try {
      const store = join(dir, "store.js");
      const installed = join(dir, "installed.js");
      writeFileSync(store, "original");
      linkSync(store, installed);
      atomicWrite(installed, "diagnostic", 0o664);
      expect(readFileSync(store, "utf8")).toBe("original");
      expect(readFileSync(installed, "utf8")).toBe("diagnostic");
      expect(statSync(installed).ino).not.toBe(statSync(store).ino);
      expect(statSync(installed).mode & 0o777).toBe(0o664);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it.each(["state", "layout"])(
    "removes exactly the %s addition, preserving surrounding bytes",
    (kind) => {
      expect(removeCausalFix(`before\n${FIX_ADDITIONS[kind]}after\n`, kind, "16.4.5")).toBe(
        "before\nafter\n",
      );
      for (const source of [
        "missing",
        FIX_ADDITIONS[kind].repeat(2),
        FIX_ADDITIONS[kind].replace("scroll", "drift"),
      ]) {
        expect(() => removeCausalFix(source, kind, "16.4.5")).toThrow();
      }
      expect(() => removeCausalFix(FIX_ADDITIONS[kind], kind, "16.4.6")).toThrow();
    },
  );
  it("matches both actual installed builds and keeps the restored #4220 safeguards", () => {
    const next = dirname(createRequire(import.meta.url).resolve("next/package.json"));
    for (const variant of ["client", "esm/client"]) {
      for (const [name, kind] of [
        ["app-router-state", "state"],
        ["layout-router", "layout"],
      ]) {
        const source = readFileSync(join(next, `dist/${variant}/components/${name}.js`), "utf8");
        const before = removeCausalFix(source, kind, "16.4.5");
        expect(before).not.toContain("initialNavigationScrollY");
        if (kind === "layout") {
          const probe = instrumentScrollRouter(before);
          expect(probe).toContain('globalThis.__nav4183?.("consume"');
          expect(probe).toContain("if (initialTargetState === 0)");
          expect(probe).toContain("scrollRef.current = false;");
          expect(() => instrumentScrollRouter("anchor drift")).toThrow();
        }
      }
    }
  });
  it("restores partially written files and checks every original hash, failing closed", () => {
    const originals = ["a", "b"].map((path) => ({
      path,
      source: `original-${path}`,
      sha256: hash(`original-${path}`),
    }));
    const files = new Map([
      ["a", "modified"],
      ["b", "original-b"],
    ]);
    const read = (path) => files.get(path);
    const write = (path, source) => files.set(path, source);
    expect(restoreOriginals(originals, read, write)).toHaveLength(2);
    expect([...files.values()]).toEqual(["original-a", "original-b"]);
    expect(() => restoreOriginals(originals, read, () => {})).not.toThrow();
    files.set("a", "unrestorable");
    expect(() => restoreOriginals(originals, read, () => {})).toThrow(/mismatch/);
    expect(() => restoreOriginals([{ ...originals[0], source: "corrupt" }], read, write)).toThrow(
      /Corrupt/,
    );
  });
});

describe("expected red requires the named assertion and causal timeline", () => {
  it("refuses a warm first visit's evidence for a later failure at the same pathname", () => {
    const r = report();
    for (const test of r.suites[0].specs[0].tests) {
      const events = test.results[0].attachments[1].body.events;
      events.splice(events.length - 1, 0, {
        kind: "click",
        url: "/shop/blue-mantis/schedule/board",
        y: 157,
        detail: { destination: "/shop/blue-mantis/trips/one" },
      });
    }
    expect(() => classify(r)).toThrow();
  });
  it("accepts only three real scroll-assertion failures with clamped intent consumption/restoration", () => {
    expect(classify(report())).toEqual(
      [0, 1, 2].map((repeat) => ({
        name: CAUSAL_TEST,
        repeat,
        scrollY: 157,
        maxTop: 69,
        clampedY: 100,
      })),
    );
  });
  it.each([0, 2, 124])("refuses process exit %s", (code) =>
    expect(() => classify(report(), code)).toThrow(),
  );
  it("refuses setup errors, other tests, missing repeats, retries, skips and unrelated failures", () => {
    const mutations = [
      (r) => r.errors.push({ message: "webServer setup failed" }),
      (r) => {
        r.suites[0].specs[0].title = "other";
      },
      (r) => r.suites[0].specs[0].tests.pop(),
      (r) => {
        r.suites[0].specs[0].tests[0].results[0].retry = 1;
      },
      (r) => {
        r.suites[0].specs[0].tests[0].results[0].status = "timedOut";
      },
      (r) => {
        r.suites[0].specs[0].tests[0].status = "skipped";
      },
      (r) => {
        r.suites[0].specs[0].tests[0].results[0].errors[0].message = "setup failed";
      },
    ];
    for (const mutate of mutations) {
      const r = report();
      mutate(r);
      expect(() => classify(r)).toThrow();
    }
  });
  it("refuses incomplete timeline/trace, a different repeat, passing geometry and mismatched numbers", () => {
    for (const mutate of [
      (result) => {
        result.attachments = [];
      },
      (result) => {
        result.attachments[1].body.repeat = 1;
      },
      (result) => {
        result.attachments[1].body.events[4].detail.pending = false;
      },
      (result) => {
        result.attachments[1].body.events[4].y = 0;
      },
      (result) => {
        result.attachments[1].body.events.splice(5, 1);
      },
      (result) => {
        result.attachments[1].body.events.at(-1).y = 0;
      },
      (result) => {
        result.errors[0].message = result.errors[0].message.replace("157", "158");
      },
    ]) {
      const r = report();
      mutate(r.suites[0].specs[0].tests[0].results[0]);
      expect(() => classify(r)).toThrow();
    }
  });
});
