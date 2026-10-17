// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { LogEntryPreview } from "./LogEntryPreview";

afterEach(cleanup);

/**
 * **A site the plan visits twice is named once** (third UX review, item 29):
 * `/ready` read "Sites: Molasses Reef, Molasses Reef" for a two-tank on one
 * reef, where the public trip page said it once.
 */
describe("LogEntryPreview", () => {
  it("names a site the day visits twice once, in plan order", () => {
    render(
      <LogEntryPreview
        line="Your log entry is waiting."
        date="Oct 13"
        siteNames={["Molasses Reef", "Molasses Reef", "French Reef"]}
        t={diverTranslator("en-US")}
      />,
    );

    expect(screen.getByTestId("log-entry-preview").textContent).toContain(
      "Molasses Reef, French Reef",
    );
    expect(screen.getByTestId("log-entry-preview").textContent).not.toContain(
      "Molasses Reef, Molasses Reef",
    );
  });
});
