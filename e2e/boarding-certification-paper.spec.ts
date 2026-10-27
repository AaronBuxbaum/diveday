import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures";

test.use({ privateShopSlug: "boarding-certification-paper" });

test("boarding evidence stays with its heading and every sheet identifies the departure", async ({
  page,
  request,
  privateShop,
}, info) => {
  const response = await request.post(
    `/api/test/seed-trouble-states?operationalTrust=capacity&certificationInterval=1&shop=${privateShop.slug}`,
  );
  expect(response.ok()).toBe(true);
  const { operationalTrust } = await response.json();
  await page.goto(`/shop/${privateShop.slug}/trips/${operationalTrust.tripId}/log`);
  await expect(
    page.getByText("Certification evidence read between", { exact: false }).first(),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts.ready);

  for (const format of ["Letter", "A4"] as const) {
    const pdf = info.outputPath(`boarding-evidence-${format}.pdf`);
    await page.pdf({ path: pdf, format, preferCSSPageSize: true, printBackground: true });
    const sheets = execFileSync("pdftotext", ["-layout", pdf, "-"], {
      encoding: "utf8",
      timeout: 30_000,
    })
      .split("\f")
      .filter((sheet) => sheet.trim().length > 0);
    expect(sheets).toHaveLength(4);
    for (const sheet of sheets) {
      expect(sheet).toContain("Operational trust departure");
      expect(sheet).toContain("Printed Jul 21, 2026");
    }
    const evidence = sheets.find((sheet) =>
      sheet.includes("Certification evidence and waiver status"),
    );
    expect(evidence).toContain("Ari Vale");
    expect(evidence).toContain("9:30:45.125 AM EDT");
    expect(evidence).toContain("9:30:45.175 AM EDT");
    expect(sheets.join(" ")).toContain("9:30:00.001 AM EDT");
    expect(sheets.join(" ")).toContain("Integrity code (SHA-256) · version 3");
    await info.attach(`boarding-evidence-${format}`, { path: pdf, contentType: "application/pdf" });
  }

  // Move the section across several page boundaries without editing the live data.
  // The heading must travel with the first card even when later cards continue.
  for (const offset of [80, 160, 240, 320]) {
    const style = await page.addStyleTag({
      content: `@media print { section:has(> #incident-evidence-heading)::before { content: ""; display: block; height: ${offset}px } }`,
    });
    const pdf = info.outputPath(`boarding-evidence-offset-${offset}.pdf`);
    await page.pdf({ path: pdf, format: "Letter", preferCSSPageSize: true, printBackground: true });
    const sheets = execFileSync("pdftotext", ["-layout", pdf, "-"], {
      encoding: "utf8",
      timeout: 30_000,
    }).split("\f");
    const evidence = sheets.find((sheet) =>
      sheet.includes("Certification evidence and waiver status"),
    );
    expect(evidence, `heading and first card at offset ${offset}px`).toContain(
      "9:30:45.125 AM EDT",
    );
    await style.evaluate((element) => element.remove());
  }
});
