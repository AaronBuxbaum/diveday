import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
});
