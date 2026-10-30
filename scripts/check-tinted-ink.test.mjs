import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchesTintedInk } from "./check-tinted-ink.mjs";
import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const CHECK_SCRIPT = fileURLToPath(new URL("./check-tinted-ink.mjs", import.meta.url));

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
    expect(matchesTintedInk("danger", "peer-checked:bg-danger/15 peer-checked:text-danger")).toBe(
      true,
    );
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

  it("runs the scanner with its source-tree exemptions and output", () => {
    const output = readBounded(process.execPath, [CHECK_SCRIPT], {
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
    });

    expect(output).toBe("tinted-ink: no coloured text sits on a translucent fill of its own hue\n");
  });

  it("honors line and boat-mode exemptions in a controlled scanner tree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tinted-ink-scanner-"));
    const scriptDirectory = path.join(root, "scripts");
    const sourceDirectory = path.join(root, "src");
    const boatModeFile = path.join(
      sourceDirectory,
      "app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.tsx",
    );
    const violationPath = path.join("src", "unannotated.tsx");
    const violation = 'const violation = "bg-danger/10 text-danger";';

    try {
      await mkdir(scriptDirectory, { recursive: true });
      await mkdir(sourceDirectory, { recursive: true });
      await mkdir(path.dirname(boatModeFile), { recursive: true });
      await copyFile(CHECK_SCRIPT, path.join(scriptDirectory, "check-tinted-ink.mjs"));
      await writeFile(
        path.join(sourceDirectory, "exemptions.tsx"),
        [
          'const sameLine = "bg-danger/10 text-danger"; // diveday:allow-tinted-ink: fixture',
          "// diveday:allow-tinted-ink: fixture",
          'const precedingLine = "bg-success/15 text-success-strong";',
        ].join("\n"),
      );
      await writeFile(boatModeFile, 'const boatMode = "bg-warning/15 text-warning";');
      await writeFile(path.join(sourceDirectory, "unannotated.tsx"), violation);

      const result = runBounded(
        process.execPath,
        [await realpath(path.join(scriptDirectory, "check-tinted-ink.mjs"))],
        { encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript },
      );
      const diagnostics = result.stderr.match(/^- src[\\/].*$/gm) ?? [];

      expect(result.status).toBe(1);
      expect(diagnostics).toEqual([`- ${violationPath}:1: ${violation}`]);
      expect(result.stderr).toContain("Coloured ink on a translucent fill of its own hue:");
      expect(result.stderr).not.toContain("exemptions.tsx");
      expect(result.stderr).not.toContain("DiverRollCall.tsx");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
