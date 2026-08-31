// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";

afterEach(cleanup);

describe("DiverFileGroupDisclosure", () => {
  it("starts closed on a phone with the group's fact in the door", () => {
    render(
      <DiverFileGroupDisclosure id="gear" label="Gear and sizes" summary="BCD M · ML long · 38">
        <p>Gear rows</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-gear");
    expect(details).not.toHaveAttribute("open");
    expect(details.querySelector("summary")).toHaveTextContent(/gear and sizes/i);
    expect(screen.getByText("BCD M · ML long · 38")).toHaveClass("tabular-nums");
    expect(screen.getByText("Gear rows")).toBeInTheDocument();
  });

  it("opens a group when its own outcome needs to be seen", () => {
    render(
      <DiverFileGroupDisclosure id="notes" label="Notes" summary="1" open>
        <p>Note body</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-notes");
    expect(details).toHaveAttribute("open");
    expect(details.querySelector("summary")).toHaveTextContent(/notes\s*1/i);
  });

  it("gives the summary a touch floor and one content region", () => {
    render(
      <DiverFileGroupDisclosure id="certifications" label="Certifications" summary="1 waiting">
        <p>Certification rows</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-certifications");
    const summary = details.querySelector("summary");
    const summaryFact = screen.getByText("1 waiting");
    expect(summary).toHaveTextContent(/certifications\s*1\s*waiting/i);
    expect(summary).not.toBeNull();
    expect(summary).toHaveClass("min-h-11", "sm:hidden");
    expect(summary).not.toHaveClass("max-sm:flex-col", "max-sm:border-b-0");
    expect(summaryFact).toHaveClass("shrink-0");
    expect(summary).toHaveAttribute("aria-controls", "certifications-content");
    expect(screen.getByTestId("diver-file-group-certifications")).toHaveClass("group/diver-file");
  });

  it("puts a long phone summary on its own wrapped line", () => {
    render(
      <DiverFileGroupDisclosure
        id="gear"
        label="Gear and sizes"
        summary="BCD M · Wetsuit M · Boots 8 · Mask & fins M · Weights 6 kg"
        stacked
      >
        <p>Gear rows</p>
      </DiverFileGroupDisclosure>,
    );

    const summary = screen.getByTestId("diver-file-group-gear").querySelector("summary");
    const label = summary?.querySelector("span.text-base");
    const value = summary?.querySelector("span.text-sm");

    expect(summary).toHaveClass(
      "max-sm:flex-col",
      "max-sm:items-stretch",
      "max-sm:py-2",
      "max-sm:border-b-0",
    );
    expect(label).toHaveClass("min-w-0", "flex-1");
    expect(value).toHaveClass(
      "min-w-0",
      "max-w-full",
      "max-sm:ms-6",
      "max-sm:whitespace-normal",
      "max-sm:break-words",
    );
    expect(value).not.toHaveClass("shrink-0");
  });

  it("keeps legacy Notes expanded on larger screens", () => {
    render(
      <DiverFileGroupDisclosure id="notes" label="Notes" summary="1">
        <p>Note body</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-notes");
    expect(details.querySelector("summary")).toHaveClass("sm:hidden");
    expect(details.querySelector(".diver-file-group-content")).toHaveClass("sm:!block");
    expect(details).not.toHaveClass("diver-file-group--desktop-collapsible");
  });

  it("keeps a desktop-collapsible group's door and body governed by native details", () => {
    render(
      <DiverFileGroupDisclosure
        id="support"
        label="Dive support"
        summary="6 arrangements"
        desktopCollapsible
      >
        <p>Support facts</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-support");
    const summary = details.querySelector("summary");
    const content = details.querySelector(".diver-file-group-content");

    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveClass("diver-file-group--desktop-collapsible");
    expect(summary).not.toHaveClass("sm:hidden");
    expect(content).not.toHaveClass("sm:!block");
    expect(summary).toHaveAttribute("aria-controls", "support-content");
  });
});
