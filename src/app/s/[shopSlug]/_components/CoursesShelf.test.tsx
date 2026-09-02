// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { CoursesShelf } from "./CoursesShelf";

/** The courses shelf's pins for ADR 20260827-clearwater-surface-language, decision 8. */
const t = diverTranslator("en-US");

afterEach(cleanup);

function course(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `course-${n}`,
    title: `Course ${n}`,
    summary: `What course ${n} teaches.`,
    heroImageUrl: null as string | null,
    heroImageAlt: `Course ${n}`,
    href: `/s/blue-mantis/courses/course-${n}`,
    price: "$195.00",
    duration: null as string | null,
    nextStart: null as string | null,
    ...overrides,
  };
}

describe("three cards and one door", () => {
  it("renders a card per course plus the All courses link", () => {
    render(
      <CoursesShelf
        courses={[course(1), course(2), course(3)]}
        allCoursesHref="/s/blue-mantis/courses"
        t={t}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "All courses" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/courses",
    );
  });

  it("renders nothing at all for a shop that teaches nothing", () => {
    const { container } = render(
      <CoursesShelf courses={[]} allCoursesHref="/s/blue-mantis/courses" t={t} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the wave placeholder", () => {
  it("stands in for a course with no photo, in the primary tint and never the accent", () => {
    const { container } = render(
      <CoursesShelf courses={[course(1)]} allCoursesHref="/s/blue-mantis/courses" t={t} />,
    );

    const placeholder = container.querySelector(".bg-primary-tint");
    expect(placeholder).not.toBeNull();
    // Decision 11's budget spends the storefront's one accent on the review
    // stars; a decorative wave may not take it.
    expect(container.querySelector(".text-accent")).toBeNull();
    expect(container.querySelector(".bg-accent")).toBeNull();
    // Drawn, never an emoji, and decorative rather than announced.
    expect(placeholder?.querySelector("svg")).not.toBeNull();
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
  });

  it("stands down the moment the shop supplies a photo", () => {
    const { container } = render(
      <CoursesShelf
        courses={[course(1, { heroImageUrl: "/uploads/ow.jpg" })]}
        allCoursesHref="/s/blue-mantis/courses"
        t={t}
      />,
    );

    expect(container.querySelector(".bg-primary-tint")).toBeNull();
  });
});

describe("a card says only what the shop wrote", () => {
  it("leaves out the summary and the price a shop has not set", () => {
    render(
      <CoursesShelf
        courses={[course(1, { summary: null, price: null })]}
        allCoursesHref="/s/blue-mantis/courses"
        t={t}
      />,
    );

    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("Course 1");
    expect(item.textContent).not.toContain("$");
    expect(item.textContent).not.toMatch(/teaches/);
  });
});

describe("the two facts under a card", () => {
  it("says how long and when next, only when the shop has each", () => {
    render(
      <CoursesShelf
        courses={[
          course(1, { duration: "4 days", nextStart: "Next Sep 7" }),
          course(2, { duration: "2 days" }),
          course(3),
        ]}
        allCoursesHref="/s/blue-mantis/courses"
        t={t}
      />,
    );
    expect(screen.getByText("4 days · Next Sep 7")).toBeInTheDocument();
    expect(screen.getByText("2 days")).toBeInTheDocument();
    // A card with neither says nothing in their place.
    const third = screen.getAllByRole("listitem")[2];
    expect(third?.textContent).not.toMatch(/·/);
  });
});
