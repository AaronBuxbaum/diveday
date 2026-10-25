import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { routeSource } from "@/test/route-source";

/**
 * **"Print with medical alerts"** (issue #2990) is a Server Component over the
 * whole trip packet, so these read its source: who it checks, that it records
 * before it renders, and that no other print ever carries the words. The
 * check and the recording themselves are `medicalAlertsForPrint`'s tests
 * (src/db/medical-alerts.test.ts); the rendered sheet is
 * `DiverRowMedicalAlert.test.tsx`'s and the e2e's.
 */
const SOURCE = routeSource(import.meta.dirname, "page.tsx");
const SRC = path.resolve(import.meta.dirname, "../../../../../../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the print with medical alerts", () => {
  it("refuses another site's navigation before it reads the session or the words", () => {
    const guard = SOURCE.indexOf("if (isCrossSiteHeaders(await headers())) notFound();");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(SOURCE.indexOf("await requireShopSurface("));
    expect(guard).toBeLessThan(SOURCE.indexOf("await medicalAlertsForPrint(db, {"));
  });

  it("keeps the alert's words off the screen: only the default packets show their paper there (security review, note 1)", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    const reveals = [
      ...css.matchAll(/([^{}]*\[data-print-only\][^{}]*)\{\s*display:\s*block/g),
    ].map((match) => match[1]?.trim());
    // Every on-screen reveal of print-only blocks needs the packet's opt-in.
    expect(reveals.length).toBeGreaterThan(0);
    for (const selector of reveals) {
      expect(selector).toContain(".trip-print-bundle[data-paper-screen]");
    }
    // This packet never opts in; the two default packets do.
    expect(SOURCE).toContain('<div className="trip-print-bundle">');
    expect(SOURCE).not.toContain("data-paper-screen");
    for (const packet of [
      "app/shop/[shopSlug]/trips/[id]/print/page.tsx",
      "app/shop/[shopSlug]/print/page.tsx",
    ]) {
      expect(readFileSync(path.join(SRC, packet), "utf8")).toContain(
        '<div className="trip-print-bundle" data-paper-screen>',
      );
    }
  });

  it("prints its own title, never the plain packet's (domain review 1, S3)", () => {
    expect(SOURCE).toContain('t("manifest.medicalAlertsPrintedTitle")');
    expect(SOURCE).not.toContain('t("shared.printPacket.title")');
    expect(staffTranslator("en-US")("manifest.medicalAlertsPrintedTitle")).not.toBe(
      staffTranslator("en-US")("shared.printPacket.title"),
    );
  });

  it("asks the server for the words, refuses with a 404, and only then composes the packet", () => {
    const asks = SOURCE.indexOf("await medicalAlertsForPrint(db, {");
    const refuses = SOURCE.indexOf("if (!printed.ok) notFound();");
    const composes = SOURCE.indexOf("await TripPacket({");
    expect(asks).toBeGreaterThan(-1);
    expect(refuses).toBeGreaterThan(asks);
    expect(composes).toBeGreaterThan(refuses);
    expect(SOURCE).toContain("printerId: session.user.personId");
    expect(SOURCE).toContain("printedMedicalAlerts: printed.printed");
  });

  it("is the only caller that hands the packet the words, and the symbol key goes nowhere else", () => {
    const handing = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, "utf8");
      return /printedMedicalAlerts:\s*printed/.test(text) || /PRINTED_MEDICAL_ALERTS\]:/.test(text);
    });
    expect(handing.map((file) => path.relative(SRC, file)).sort()).toEqual([
      "app/shop/[shopSlug]/trips/[id]/print/_components/TripPacket.tsx",
      "app/shop/[shopSlug]/trips/[id]/print/medical-alerts/page.tsx",
    ]);
    // The default packet and the day's paper never pass any.
    for (const other of [
      "app/shop/[shopSlug]/trips/[id]/print/page.tsx",
      "app/shop/[shopSlug]/print/page.tsx",
    ]) {
      expect(readFileSync(path.join(SRC, other), "utf8")).not.toContain("printedMedicalAlerts");
    }
  });

  it("composes the manifest as paper, and the paper rows still carry the words (B03)", () => {
    const packet = readFileSync(
      path.join(SRC, "app/shop/[shopSlug]/trips/[id]/print/_components/TripPacket.tsx"),
      "utf8",
    );
    // The words and the paper flag ride the same searchParams to both pages.
    expect(packet).toMatch(/\[PAPER_PACKET\]: true/);
    expect(packet).toContain("[PRINTED_MEDICAL_ALERTS]: printedMedicalAlerts");
    const read = (file: string) =>
      readFileSync(path.join(SRC, "app/shop/[shopSlug]/trips/[id]/manifest", file), "utf8");
    // The paper renders the same roll-call props the screen does, and the
    // words are bound into them.
    expect(read("_components/roll-call-props.ts")).toContain("...actions.medicalAlert,");
    const page = read("page.tsx");
    expect(page).toContain("rollCall={rollCall}");
    expect(page.indexOf("if (paper) {")).toBeLessThan(page.indexOf("<SkipLink"));
    const paper = read("_components/ManifestPaper.tsx");
    expect(paper).toContain("<DiverRollCall context={{ ...rollCall.divers, paper: true }} />");
    expect(paper).toContain("<PrintedSoulsOnBoard");
    expect(paper).toContain("<CrewRollCall {...rollCall.crew} paper />");
    expect(paper).toContain("{boatPaper}");
  });
});
