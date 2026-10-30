import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchesTintedInk, runTintedInkCheck } from "./check-tinted-ink.mjs";

/**
 * The check's judgement, not its plumbing. It shipped matching `/10` only, on
 * the argument that the `/15` family mostly rendered under `.boat-mode` and a
 * grep could not tell which. Measured (issue #874), that was right about the
 * palette and wrong about the remedy: boat-mode is compliant at 15% (4.98:1
 * worst case) while one app-palette line sat at 4.33:1 — invisible to the
 * narrow pattern.
 */
describe("what the tinted-ink check flags", () => {
  it("catches every opacity, not only the canonical 10%", () => {
    for (const fill of ["bg-danger/5", "bg-danger/10", "bg-danger/15", "bg-danger/20"]) {
      expect(matchesTintedInk("danger", `${fill} text-danger`), fill).toBe(true);
    }
  });

  it("catches it behind a variant, which is where the hover states live", () => {
    expect(matchesTintedInk("danger", "text-danger hover:bg-danger/10")).toBe(true);
    expect(
      matchesTintedInk("danger", "peer-checked:bg-danger/15 peer-checked:text-danger"),
    ).toBe(true);
  });

  it("leaves an opaque tint alone — that is the fix, not the defect", () => {
    expect(matchesTintedInk("success", "bg-success-tint text-success-strong")).toBe(false);
  });

  /**
   * A fill of one hue under ink of another is the *nastier* version of this
   * bug — a `bg-primary/10` badge on a green row was the worst ratio in the app
   * — but it is not same-element, so this check does not claim it. The axe scan
   * covered that until it was removed on 2026-10-24; nothing does now.
   */
  it("does not claim a mismatched pair it cannot reason about", () => {
    expect(matchesTintedInk("primary", "bg-primary/10 text-success")).toBe(false);
    expect(matchesTintedInk("success", "bg-primary/10 text-success")).toBe(false);
  });

  /**
   * The opaque token starts with the same eleven characters as the fill it
   * replaces, so an unanchored pattern would flag the fix as the defect. `\d+`
   * after the slash is what tells them apart.
   */
  it("does not match the opaque token, which starts the same way", () => {
    expect(matchesTintedInk("success", "bg-success-tint text-success-strong")).toBe(false);
    expect(matchesTintedInk("danger", "bg-surface/90 text-muted")).toBe(false);
  });

  it("keeps scanner exemptions and diagnostic output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tinted-ink-"));
    const output = {
      errors: [],
      logs: [],
      error(message) {
        this.errors.push(message);
      },
      log(message) {
        this.logs.push(message);
      },
    };
    const writeSource = async (relativePath, content) => {
      const file = path.join(root, "src", relativePath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    };

    try {
      await writeSource(
        "components/violates.tsx",
        "const bad = 'bg-danger/15 text-danger-strong';\n",
      );
      await writeSource(
        "components/allowed.tsx",
        "const sameLine = 'bg-success/10 text-success'; // diveday:allow-tinted-ink: measured\n"
          + "// diveday:allow-tinted-ink: measured\n"
          + "const nextLine = 'bg-warning/5 text-warning';\n",
      );
      await writeSource(
        "app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.tsx",
        "const boat = 'bg-info/15 text-info';\n",
      );

      expect(await runTintedInkCheck({ root, output })).toBe(false);
      expect(output.errors).toHaveLength(3);
      expect(output.errors[0]).toContain("- src/components/violates.tsx:1: const bad = 'bg-danger/15 text-danger-strong';");
      expect(output.errors[0]).not.toContain("allowed.tsx");
      expect(output.errors[0]).not.toContain("DiverRollCall.tsx");
      expect(output.logs).toEqual([]);

      await writeSource("components/violates.tsx", "const fixed = 'bg-danger-tint text-danger-strong';\n");
      output.errors.length = 0;
      expect(await runTintedInkCheck({ root, output })).toBe(true);
      expect(output.errors).toEqual([]);
      expect(output.logs).toEqual(["tinted-ink: no coloured text sits on a translucent fill of its own hue"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
