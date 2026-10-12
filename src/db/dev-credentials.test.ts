import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_SHOP_SLUG } from "./demo-shop";
import demoShop from "./demo-shop.json";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import credentials from "./dev-credentials.json";

/**
 * The dev logins and the demo slug have one source each (`dev-credentials.json`,
 * `demo-shop.json`), so
 * a `.mjs` script that cannot import TypeScript still cannot drift from the
 * seed: a copy that fell behind signed the contact sheet in as nobody and
 * photographed the sign-in page for every route (issue #2339).
 */
const SCRIPTS = path.join(process.cwd(), "scripts");

function scriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return scriptFiles(full);
    return /\.(mjs|ts)$/.test(name) && !/\.test\.(mjs|ts)$/.test(name) ? [full] : [];
  });
}

describe("dev credentials", () => {
  it("re-exports the JSON files unchanged", () => {
    expect(DEV_STAFF_LOGINS).toEqual(credentials.staffLogins);
    expect(DEMO_SHOP_SLUG).toBe(demoShop.slug);
  });

  it("is declared nowhere in scripts/ but the JSON files", () => {
    const copies = scriptFiles(SCRIPTS).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const found: string[] = [];
      if (/["'`][^"'`\s]+@demo\.invalid["'`]/.test(source)) found.push("a demo login email");
      if (/=\s*["'`]blue-mantis["'`]/.test(source)) found.push("the demo shop slug");
      return found.map((what) => `${path.relative(process.cwd(), file)}: ${what}`);
    });

    expect(copies).toEqual([]);
  });
});
