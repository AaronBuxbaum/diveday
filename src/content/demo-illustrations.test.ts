import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEMO_ILLUSTRATIONS,
  type DemoIllustrationScene,
  demoIllustration,
} from "./demo-illustrations";
import ledger from "./photo-records.json";
import { demoPlaceholderAllowed } from "./photo-rules";

describe("fictional demo artwork provenance", () => {
  it("rejects real shops, unmarked files, and species or site catalog assignments", () => {
    const good = {
      isDemo: true,
      file: "demo-shop/generated/boat.webp",
      subject: "demo:boat",
      marked: true,
    };
    expect(demoPlaceholderAllowed(good)).toBe(true);
    for (const change of [
      { isDemo: false },
      { marked: false },
      { subject: "species:blue-tang" },
      { subject: "site:molasses-reef" },
      { file: "marine-life/boat.jpg" },
    ]) {
      expect(demoPlaceholderAllowed({ ...good, ...change })).toBe(false);
    }
  });

  it("records each reviewed delivery image separately from licensed photographs", () => {
    for (const scene of Object.keys(DEMO_ILLUSTRATIONS) as DemoIllustrationScene[]) {
      const { url, alt } = demoIllustration(scene);
      const file = url.slice(1);
      const record = ledger.demoPlaceholders[file as keyof typeof ledger.demoPlaceholders];
      expect(
        demoPlaceholderAllowed({
          isDemo: true,
          file,
          subject: record.subject,
          marked: Boolean(record.marking),
        }),
      ).toBe(true);
      expect(record.generated).toBe(true);
      expect(record.subject).toBe(`demo:${scene}`);
      if (scene === "fleet") {
        expect(record.approval).toBe("User request, 2026-11-14");
        expect(record.reviewed).toBe("2026-11-14");
      } else {
        expect(record.approval).toContain("4381#issuecomment-6814035938");
        expect(record.reviewed).toBe("2026-11-12");
      }
      expect(alt).toContain("Generated demo illustration");
      expect(statSync(`public/${file}`).size).toBeLessThan(450_000);
      const data = readFileSync(`public/${file}`);
      expect(data.subarray(8, 12).toString()).toBe("WEBP");
    }
  });
});
