// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AddPanel } from "./AddPanel";

afterEach(cleanup);

/**
 * **The "Add a …" panel insets its fields as the list above it does.** Kinds
 * of day, seasons and boats each hand-rolled the dashed panel under their list
 * at `p-4`, 16px inside its border, while the list's rows are `p-3`, 12px: at
 * 1280 the rows' boxes started at x 466 and the panel's at 470, and at 390 the
 * panel's ran 4px short on both sides (K-234, SETTINGS-2-15, SETTINGS-3-06).
 * One component, so the three copies cannot drift apart again.
 */
describe("AddPanel", () => {
  it("draws the dashed sunken panel at the list rows' 12px inset", () => {
    const { container } = render(
      <AddPanel title="Add new boat">
        <input aria-label="Boat name" />
      </AddPanel>,
    );
    const panel = container.firstElementChild as HTMLElement;
    for (const token of ["rounded-lg", "border", "border-dashed", "bg-surface-sunken", "p-3"]) {
      expect(panel).toHaveClass(token);
    }
    expect(panel).not.toHaveClass("p-4");
    expect(screen.getByRole("heading", { level: 2, name: "Add new boat" })).toBeInTheDocument();
    expect(screen.getByLabelText("Boat name")).toBeInTheDocument();
  });

  it.each(["kinds-of-day", "seasons", "boats"])(
    "is the only add panel the %s page draws",
    (page) => {
      const source = readFileSync(join(import.meta.dirname, "..", page, "page.tsx"), "utf8");
      expect(source).toContain("<AddPanel");
      expect(source, "no hand-rolled dashed panel").not.toContain("border-dashed");
    },
  );
});
