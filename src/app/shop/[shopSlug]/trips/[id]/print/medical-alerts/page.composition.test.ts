import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { routeSource } from "@/test/route-source";

/**
 * **"Print with medical alerts"** (issue #2990) is a Server Component over the
 * whole trip packet, so these read its source: who it checks, that it records
 * before it renders, and that no other print ever carries the words. The
 * check and the recording themselves are `readMedicalAlertsForPrint`'s and `recordMedicalAlertsPrint`'s tests
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
    expect(guard).toBeLessThan(SOURCE.indexOf("await readMedicalAlertsForPrint(db, {"));
  });

  it("keeps the alert's words off the screen: this packet's sheets reach paper only (security review, note 1)", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const reveals = [
      ...css.matchAll(/([^{}]*\[data-print-only\][^{}]*)\{\s*display:\s*block/g),
    ].map((match) => match[1]?.trim());
    // A sheet shows its paper rows on screen, so this packet keeps its sheets
    // off the screen altogether.
    expect(reveals).toEqual([".paper-sheet [data-print-only]"]);
    expect(SOURCE).toContain("printOnly={");
    const document = readFileSync(
      path.join(SRC, "app/shop/[shopSlug]/print/_components/SheetDocument.tsx"),
      "utf8",
    );
    expect(document).toContain('data-paper-print-only={printOnly ? "" : undefined}');
    // Unlayered and !important: Tailwind's `hidden` sits in a cascade layer
    // and lost to the frame's own unlayered `display: flex` (security review
    // of #3724, H1).
    expect(css).toMatch(
      /@media screen\s*\{\s*\.paper-sheet-frame\[data-paper-print-only\]\s*\{\s*display:\s*none !important;/,
    );
    // The two default packets show their sheets.
    for (const packet of [
      "app/shop/[shopSlug]/trips/[id]/_components/TripPacketSheet.tsx",
      "app/shop/[shopSlug]/print/page.tsx",
    ]) {
      expect(readFileSync(path.join(SRC, packet), "utf8")).not.toContain("printOnly");
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
    const asks = SOURCE.indexOf("await readMedicalAlertsForPrint(db, {");
    const refuses = SOURCE.indexOf("if (!read.ok) notFound();");
    const composes = SOURCE.indexOf("await readTripPacket({");
    expect(asks).toBeGreaterThan(-1);
    expect(refuses).toBeGreaterThan(asks);
    expect(composes).toBeGreaterThan(refuses);
    expect(SOURCE).toContain("printerId: session.user.personId");
    expect(SOURCE).toContain("printedMedicalAlerts: read.printed");
  });

  it("records the print only once the packet is known to be printable, and before it renders (issue #3727)", () => {
    const composes = SOURCE.indexOf("await readTripPacket({");
    const missing = SOURCE.indexOf('if (packet.status === "missing") notFound();');
    const stable = SOURCE.indexOf('if (packet.status === "stable") {');
    const records = SOURCE.indexOf("await recordMedicalAlertsPrint(db, {");
    const renders = SOURCE.indexOf("packet.sheets(");
    expect(composes).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(composes);
    expect(stable).toBeGreaterThan(missing);
    expect(records).toBeGreaterThan(stable);
    expect(renders).toBeGreaterThan(records);
    // Nothing writes the trail ahead of the composed packet.
    expect(SOURCE.indexOf("recordMedicalAlertsPrint(")).toBeGreaterThan(composes);
    // The sheet gets only the words the trail took.
    expect(SOURCE).toContain("printedMedicalAlerts: printed });");
  });

  it("is the only caller that hands the packet the words", () => {
    const handing = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, "utf8");
      return /printedMedicalAlerts:\s*(read\.)?printed/.test(text);
    });
    expect(handing.map((file) => path.relative(SRC, file)).sort()).toEqual([
      "app/shop/[shopSlug]/trips/[id]/print/medical-alerts/page.tsx",
    ]);
    // The default packet and the day's paper never pass any.
    for (const other of [
      "app/shop/[shopSlug]/trips/[id]/_components/TripPacketSheet.tsx",
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
    // The words reach the shared view as an argument, never a URL value.
    expect(packet).toContain("printedMedicalAlerts,\n      locale,");
    const read = (file: string) =>
      readFileSync(path.join(SRC, "app/shop/[shopSlug]/trips/[id]/manifest", file), "utf8");
    // The sheet renders the same roll-call props the screen does, and the
    // words are bound into them.
    expect(read("_components/roll-call-props.ts")).toContain("...actions.medicalAlert,");
    expect(read("_components/manifest-view.ts")).toContain(
      "bindManifestActions(actionContext, read.reader, printedMedicalAlerts)",
    );
    expect(packet).toContain("rollCall={manifest.rollCall}");
    const paper = read("_components/ManifestPaper.tsx");
    expect(paper).toContain("<DiverRollCall context={{ ...rollCall.divers, paper: true }} />");
    expect(paper).toContain("<PrintedSoulsOnBoard");
    expect(paper).toContain("<CrewRollCall {...rollCall.crew} paper />");
    expect(paper).toContain("{boatPaper}");
  });
});
