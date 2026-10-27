// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SavedPrintDetails } from "./SavedPrintDetails";

afterEach(cleanup);
it("retains supplied saved text and omits empty supplementary sections", () => {
  render(
    <SavedPrintDetails
      title="Saved details"
      sections={[
        { title: "Briefing", lines: ["Stored route", null, ""] },
        { title: "No saved notes", lines: [] },
      ]}
    />,
  );
  expect(screen.getByText("Stored route")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "No saved notes" })).toBeNull();
});
