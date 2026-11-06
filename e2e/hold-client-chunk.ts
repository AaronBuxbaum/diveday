import { readdirSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

/** Hold a real emitted client chunk before delivery, without fetching or fulfilling it twice. */
export async function holdClientChunk(page: Page, needle: string) {
  const chunks = new Set(
    readdirSync(".next/static/chunks", { recursive: true, encoding: "utf8" })
      .filter(
        (file) =>
          file.endsWith(".js") &&
          readFileSync(`.next/static/chunks/${file}`, "utf8").includes(needle),
      )
      .map((file) => `/_next/static/chunks/${file.replaceAll("\\", "/")}`),
  );
  if (chunks.size === 0)
    throw new Error(`No emitted client chunk contains ${JSON.stringify(needle)}`);

  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(
    (url) => chunks.has(url.pathname),
    async (route) => {
      requested();
      await gate;
      await route.continue();
    },
  );
  return { requested: pending, release };
}
