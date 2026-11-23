// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { ReadyPageData } from "../../../../../features/boarding/ready";
import { CourseMaterials } from "./CourseMaterials";

/**
 * The thread's "Before your first day" list (ADR 20261008-course-learning-materials).
 * The rule with the most weight is the referrer: this page's URL is a bearer
 * capability, so a link out must never carry it.
 */
const t = diverTranslator("en-US");

type Data = Pick<
  ReadyPageData,
  "learningMaterials" | "elearningCode" | "elearningSold" | "courseMaterialsDone" | "courseStarted"
>;
function data(over: Partial<Data>): Data {
  return {
    learningMaterials: [],
    elearningCode: null,
    elearningSold: false,
    courseMaterialsDone: false,
    courseStarted: false,
    ...over,
  };
}

afterEach(cleanup);

describe("CourseMaterials", () => {
  it("renders nothing for a course with no materials", () => {
    const { container } = render(<CourseMaterials data={data({})} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each material without a referrer and keeps its note", () => {
    render(
      <CourseMaterials
        data={data({
          learningMaterials: [
            {
              name: "PADI Open Water eLearning",
              url: "https://www.padi.com/",
              note: "Before day 1",
            },
            { name: "Logbook" },
          ],
        })}
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

  it("shows the code the shop handed this student, even for a course with no materials list", () => {
    render(<CourseMaterials data={data({ elearningCode: "AB12-CD34" })} t={t} />);
    expect(screen.getByRole("heading", { name: "Before your first day" })).toBeInTheDocument();
    expect(screen.getByText("AB12-CD34")).toBeInTheDocument();
  });

  it("never renders a link that is not https", () => {
    render(
      <CourseMaterials
        data={data({ learningMaterials: [{ name: "Old manual", url: "javascript:alert(1)" }] })}
        t={t}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Old manual")).toBeInTheDocument();
  });

  it("keeps the list under a settled line once the shop marks it done", () => {
    render(
      <CourseMaterials
        data={data({ learningMaterials: [{ name: "Logbook" }], courseMaterialsDone: true })}
        t={t}
      />,
    );
    expect(screen.getByText("The shop has these marked done")).toBeInTheDocument();
    expect(screen.getByText("Logbook")).toBeInTheDocument();
  });

  it("drops 'Before your first day' once the session has begun", () => {
    render(
      <CourseMaterials
        data={data({ learningMaterials: [{ name: "Logbook" }], courseStarted: true })}
        t={t}
      />,
    );
    expect(screen.getByRole("heading", { name: "Course materials" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Before your first day" })).toBeNull();
  });
});

const ACCESS_SENTENCE =
  "Your access code shows up right here once the shop gives it to you. Not here yet? Write or call the shop.";

describe("CourseMaterials: how e-learning access arrives", () => {
  const withMaterials = {
    learningMaterials: [{ name: "PADI Open Water eLearning", note: "Finish before day 1" }],
    elearningSold: true,
  };

  it("says the code comes after booking and offers the shop's own email and phone before one arrives", () => {
    render(
      <CourseMaterials
        data={data(withMaterials)}
        contactEmail="courses@example.com"
        contactPhone="+1 305 555 0100"
        t={t}
      />,
    );
    expect(screen.getByText(ACCESS_SENTENCE, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Ask the shop about access")).toBeNull();
    expect(screen.getByRole("link", { name: "courses@example.com" })).toHaveAttribute(
      "href",
      "mailto:courses@example.com",
    );
    expect(screen.getByRole("link", { name: "+1 305 555 0100" })).toHaveAttribute(
      "href",
      "tel:+13055550100",
    );
  });

  it("shows the code with the material's own start line and no access sentence once the student has one", () => {
    render(
      <CourseMaterials
        data={data({ ...withMaterials, elearningCode: "AB12-CD34" })}
        contactEmail="courses@example.com"
        t={t}
      />,
    );
    expect(screen.getByText("AB12-CD34")).toBeInTheDocument();
    expect(screen.getByText(/Finish before day 1/)).toBeInTheDocument();
    expect(screen.queryByText(ACCESS_SENTENCE)).toBeNull();
  });

  it("promises no code for a course that sells no e-learning", () => {
    render(
      <CourseMaterials
        data={data({ learningMaterials: [{ name: "Logbook" }], elearningSold: false })}
        contactEmail="courses@example.com"
        t={t}
      />,
    );
    expect(screen.queryByText(ACCESS_SENTENCE)).toBeNull();
  });

  it("says nothing about access once the shop has marked the materials done", () => {
    render(
      <CourseMaterials
        data={data({ ...withMaterials, courseMaterialsDone: true })}
        contactEmail="courses@example.com"
        t={t}
      />,
    );
    expect(screen.queryByText(ACCESS_SENTENCE)).toBeNull();
  });

  it("keeps the link where the shop pointed it", () => {
    render(
      <CourseMaterials
        data={data({
          ...withMaterials,
          learningMaterials: [{ name: "PADI eLearning", url: "https://www.padi.com/" }],
        })}
        t={t}
      />,
    );
    expect(screen.getByRole("link", { name: "PADI eLearning" })).toHaveAttribute(
      "href",
      "https://www.padi.com/",
    );
  });
});
