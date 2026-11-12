import path from "node:path";
import type { Page } from "@playwright/test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MoveAskTarget } from "../src/app/(token)/ready/[token]/_components/MoveAskTarget";
import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";

const diver = diverTranslator("en-US");

const targetPath = path.resolve("src/app/(token)/ready/[token]/_components/MoveAskTarget.tsx");
let bundle: Promise<string> | undefined;
function hydrationBundle() {
  bundle ??= build({
    stdin: {
      contents: `import { createElement, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { MoveAskTarget } from ${JSON.stringify(targetPath)};
function Fixture() {
  useEffect(() => document.documentElement.setAttribute("data-focus-fixture-hydrated", "true"), []);
  return createElement(MoveAskTarget, { className: "" }, createElement("input", { "aria-label": "Dates" }));
}
hydrateRoot(document.getElementById("mount"), createElement(Fixture));`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  }).then((result) => result.outputFiles[0].text);
  return bundle;
}

/** Isolate the real target's SSR/hydration boundary; native anchors remain browser-owned. */
async function openStagedTarget(page: Page) {
  const release = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  const javascript = await hydrationBundle();
  const markup = renderToString(
    createElement(
      MoveAskTarget,
      { className: "" },
      createElement("input", { "aria-label": "Dates" }),
    ),
  );
  await page.route("**/__move-ask-focus-client.js", async (route) => {
    requested.resolve();
    await release.promise;
    await route.fulfill({ contentType: "application/javascript", body: javascript });
  });
  await page.route("**/__move-ask-focus", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><a href="#move-ask">${diver("ready.moveAsk.changePlans")}</a><input aria-label="Elsewhere"><div id="staging" hidden><div id="mount">${markup}</div></div><script async src="/__move-ask-focus-client.js"></script></body></html>`,
    }),
  );
  await page.goto("/__move-ask-focus", { waitUntil: "domcontentloaded" });
  await requested.promise;
  return {
    reveal: () =>
      page.evaluate(() => {
        const mount = document.getElementById("mount");
        if (!mount) throw new Error("Missing streamed target");
        document.body.append(mount);
        document.getElementById("staging")?.remove();
      }),
    hydrate: async () => {
      release.resolve();
      await expect(page.locator("html")).toHaveAttribute("data-focus-fixture-hydrated", "true");
    },
    release: () => release.resolve(),
  };
}

for (const scenario of ["ordinary", "delayed", "moved elsewhere"] as const) {
  test(`move request fragment preserves focus through ${scenario} hydration`, async ({
    page,
  }, testInfo) => {
    const staged = await openStagedTarget(page);
    try {
      if (scenario === "ordinary") await staged.reveal();
      await page
        .getByRole("link", { name: diver("ready.moveAsk.changePlans"), exact: true })
        .click();
      await expect(page).toHaveURL(/#move-ask$/);
      if (scenario !== "ordinary") {
        // The target exists in React's hidden staging container when the native click lands.
        await expect(page.locator("#move-ask")).toBeHidden();
        await expect(page.locator("body")).toBeFocused();
        await staged.reveal();
      } else {
        await expect(page.locator("#move-ask")).toBeFocused();
      }
      if (scenario === "moved elsewhere")
        await page.getByRole("textbox", { name: "Elsewhere" }).click();
      await staged.hydrate();
      await expect(
        scenario === "moved elsewhere"
          ? page.getByRole("textbox", { name: "Elsewhere" })
          : page.locator("#move-ask"),
      ).toBeFocused();
      if (scenario === "delayed") {
        await page.screenshot({ path: testInfo.outputPath("move-ask-focused.png") });
      }
    } finally {
      staged.release();
    }
  });
}
