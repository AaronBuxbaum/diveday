import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { staffDefs } from "./seed-cast";

const DEMO_STAFF_PORTRAITS = JSON.parse(
  readFileSync("docs/design/staff-portraits.json", "utf8"),
) as Record<string, { url: string; alt: string } | null>;

describe("fictional demo staff portrait assets", () => {
  it("accounts for every stable cast key without identifying people by name", () => {
    expect(Object.keys(DEMO_STAFF_PORTRAITS).sort()).toEqual(
      staffDefs.map((staff) => staff.local).sort(),
    );
    expect(DEMO_STAFF_PORTRAITS.sal).toBeNull();
  });

  it("provides distinct bundled portraits with exact prompt records", () => {
    const doc = readFileSync("docs/design/staff-portraits.md", "utf8");
    const urls = new Set<string>();
    for (const portrait of Object.values(DEMO_STAFF_PORTRAITS)) {
      if (!portrait) continue;
      expect(portrait.alt).toMatch(/^Generated demo portrait of fictional /);
      expect(existsSync(path.join("public", portrait.url))).toBe(true);
      expect(doc).toContain(`public${portrait.url}`);
      expect(urls.has(portrait.url)).toBe(false);
      urls.add(portrait.url);
    }
    expect(urls.size).toBe(5);
  });
});
