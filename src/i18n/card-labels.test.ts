import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CERTIFICATION_ROW_STATE_BADGE, heldCardStatusTone } from "./card-labels";

/**
 * **Confirm to clear: one fact, two tones** (issue #1869). An imported
 * specialty card nobody has confirmed is a neutral prompt on its own row and a
 * warning wherever the unfinished work is summarized. The glossary, this
 * module's two tone sources and the diver-record door once said three
 * different things; this pins the code to the glossary's sentence, so a change
 * to either side fails here until the other follows.
 */
describe("confirm to clear: the row badge is a prompt, every summary is a warning", () => {
  it("gives the same card a neutral row badge and a warning held status", () => {
    expect(CERTIFICATION_ROW_STATE_BADGE.imported_unconfirmed?.tone).toBe("neutral");
    expect(heldCardStatusTone("confirm_to_clear")).toBe("warning");
  });

  it("is the rule the glossary's entry states", async () => {
    const glossary = await readFile(path.join(process.cwd(), "docs/product/glossary/certification.md"), "utf8");
    const entry = glossary
      .split(/^- \*\*/m)
      .find((block) => block.startsWith("Confirm to clear**"));
    expect(entry, "docs/product/glossary/certification.md has no **Confirm to clear** entry").toBeDefined();
    const text = (entry ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/card's own row[^.]*\*\*neutral\*\* tone/);
    expect(text).toMatch(/Every summary[^.]*\*\*warning\*\* tone/);
    expect(text).toContain("Certification records door");
  });
});
