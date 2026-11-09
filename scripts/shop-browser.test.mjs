import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, test, vi } from "vitest";
import { authorizedBrowserRequest } from "./shop-browser.ts";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

describe("local operator browser boundary", () => {
  const origin = "http://127.0.0.1:14321";
  const headers = {
    host: "127.0.0.1:14321",
    origin,
    authorization: "Bearer private-launch-secret",
  };
  it("requires the private launch secret and exact local origin and host on POST", () => {
    expect(
      authorizedBrowserRequest({ method: "POST", headers }, origin, "private-launch-secret"),
    ).toBe(true);
    for (const overrides of [
      { authorization: undefined },
      { authorization: "Bearer wrong" },
      { origin: "https://attacker.example" },
      { host: "attacker.example:14321" },
      { origin: undefined },
    ]) {
      expect(
        authorizedBrowserRequest(
          { method: "POST", headers: { ...headers, ...overrides } },
          origin,
          "private-launch-secret",
        ),
      ).toBe(false);
    }
    expect(
      authorizedBrowserRequest({ method: "GET", headers }, origin, "private-launch-secret"),
    ).toBe(false);
  });
});

test("the documented tsx launcher refuses a missing explicit database URL", () => {
  const result = runBounded(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/shop-browser.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: "" },
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Explicit database access is required");
});

test("shows a generated link beside its selected shop and remains usable after another search", async () => {
  const dom = new JSDOM(readFileSync("scripts/shop-browser/index.html", "utf8"), {
    url: "http://127.0.0.1:1234/#launch-secret",
    runScripts: "outside-only",
  });
  try {
    dom.window.HTMLElement.prototype.scrollIntoView = vi.fn();
    dom.window.fetch = vi.fn(async (path) => ({
      ok: true,
      json: async () =>
        String(path).startsWith("/shops")
          ? { rows: [{ name: "Coral Cove", slug: "coral-cove", is_demo: true }], next: null }
          : {
              url: "https://dive.day/email-sign-in/temporary-test-link",
              expiresAt: "2026-11-10T00:00:00Z",
            },
    }));
    dom.window.eval(readFileSync("scripts/shop-browser/app.js", "utf8"));
    const doc = dom.window.document;
    await vi.waitFor(() => expect(doc.querySelectorAll("#shops li")).toHaveLength(1));
    const generate = () =>
      [...doc.querySelectorAll("#shops button")].find((button) =>
        button.textContent.includes("Generate"),
      );
    generate().click();
    await vi.waitFor(() => expect(doc.querySelector("#recovery").hidden).toBe(false));
    expect(doc.querySelector("#recovery").closest("li")?.querySelector("code").textContent).toBe(
      "coral-cove",
    );
    expect(doc.querySelector("#recovery h2").textContent).toContain("Coral Cove");
    doc
      .querySelector("#search")
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(doc.querySelector("#status").textContent).toBe("1 shops"));
    generate().click();
    await vi.waitFor(() => expect(doc.querySelector("#recovery")?.hidden).toBe(false));
  } finally {
    dom.window.close();
  }
});
