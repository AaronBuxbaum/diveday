// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { CourseMaterials } from "./CourseMaterials";

/**
 * The thread's "Before your first day" list (ADR 20261008-course-learning-materials).
 * The rule with the most weight is the referrer: this page's URL is a bearer
 * capability, so a link out must never carry it.
 */
const t = diverTranslator("en-US");

afterEach(cleanup);

describe("CourseMaterials", () => {
  it("renders nothing for a course with no materials", () => {
    const { container } = render(<CourseMaterials materials={[]} done={false} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each material without a referrer and keeps its note", () => {
    render(
      <CourseMaterials
        materials={[
          { name: "PADI Open Water eLearning", url: "https://www.padi.com/", note: "Before day 1" },
          { name: "Logbook" },
        ]}
        done={false}
        t={t}
      />,
    );
    expect(screen.getByRole("heading", { name: "Before your first day" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "PADI Open Water eLearning" });
    expect(link).toHaveAttribute("href", "https://www.padi.com/");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByText(/Before day 1/)).toBeInTheDocument();
    expect(screen.getByText("Logbook").closest("a")).toBeNull();
    expect(screen.queryByText("The shop has these marked done")).toBeNull();
  });

  it("never renders a link that is not https", () => {
    render(
      <CourseMaterials
        materials={[{ name: "Old manual", url: "javascript:alert(1)" }]}
        done={false}
        t={t}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Old manual")).toBeInTheDocument();
  });

  it("keeps the list under a settled line once the shop marks it done", () => {
    render(<CourseMaterials materials={[{ name: "Logbook" }]} done t={t} />);
    expect(screen.getByText("The shop has these marked done")).toBeInTheDocument();
    expect(screen.getByText("Logbook")).toBeInTheDocument();
  });
});
