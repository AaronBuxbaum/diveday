import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The file order is a server-page composition rule, not a data calculation. */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

function countOf(marker: string): number {
  return SOURCE.split(marker).length - 1;
}

describe("the diver record file order", () => {
  it("keeps Notes before the shared Dive support group", () => {
    const notes = positionOf("<DiverNotesSection");
    const support = positionOf("<SupportNeedsPanel");
    const activity = positionOf("<ActivitySection");

    for (const marker of [notes, support, activity]) expect(marker).toBeGreaterThan(-1);
    expect(notes).toBeLessThan(support);
    expect(support).toBeLessThan(activity);
    expect(countOf("<SupportNeedsPanel")).toBe(1);
  });

  it("keeps support outcomes routed to the support group's own anchor", () => {
    expect(SOURCE).toContain('status={noticeForForm(diverNotice, "support")}');
  });
});
