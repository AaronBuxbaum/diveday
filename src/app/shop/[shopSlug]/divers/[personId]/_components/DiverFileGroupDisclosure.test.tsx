// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";

afterEach(cleanup);

describe("DiverFileGroupDisclosure", () => {
  it("starts closed on a phone with the group's fact in the door", () => {
    render(
      <DiverFileGroupDisclosure
        id="gear"
        label="Gear and sizes"
        summary="BCD M · ML long · 38"
      >
        <p>Gear rows</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-gear");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: /gear and sizes/i })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /notes 1/i })).toBeInTheDocument();
  });

  it("gives the summary a touch floor and one content region", () => {
    render(
      <DiverFileGroupDisclosure id="certifications" label="Certifications" summary="1 waiting">
        <p>Certification rows</p>
      </DiverFileGroupDisclosure>,
    );

    const summary = screen.getByRole("button", { name: /certifications 1 waiting/i });
    expect(summary).toHaveClass("min-h-11", "sm:hidden");
    expect(summary).toHaveAttribute("aria-controls", "certifications-content");
    expect(screen.getByTestId("diver-file-group-certifications")).toHaveClass(
      "group/diver-file",
    );
  });
});
