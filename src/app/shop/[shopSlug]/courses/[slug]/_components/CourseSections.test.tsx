// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Course } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import { CourseHero } from "./CourseSections";

/**
 * The course hero's price is a *list* price, so it follows `shops.currency` —
 * a Cozumel shop quotes pesos and a Tokyo shop quotes whole yen (task 35,
 * docs ADR 20260731-shop-currency).
 */
function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    shopId: "shop-1",
    title: "Open Water Diver",
    agency: "padi",
    description: null,
    slug: "open-water-diver",
    summary: null,
    overview: null,
    heroImageUrl: null,
    heroImageAlt: null,
    imageUrls: [],
    imageAlts: [],
    durationText: null,
    groupSizeText: null,
    minimumAge: null,
    prerequisiteNote: null,
    includes: [],
    excludes: [],
    scheduleDays: [],
    faqs: [],
    priceCents: null,
    eLearningPriceCents: null,
    minimumCertificationLevel: null,
    isActive: true,
    ...overrides,
  } as Course;
}

const t = diverTranslator("en-US");

afterEach(cleanup);

describe("CourseHero price currency (task 35)", () => {
  it("renders the shop's own currency rather than dollars", () => {
    render(
      <CourseHero
        course={course()}
        totalCents={480_000}
        bookHref={null}
        currency="mxn"
        locale="en-US"
        t={t}
      />,
    );

    expect(screen.getByText(/MX\$4,800/)).toBeInTheDocument();
    expect(screen.queryByText(/^\$4,800/)).not.toBeInTheDocument();
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    // JPY stores whole yen: a ¥48,000 course is `48000`, and a literal
    // `/ 100` would advertise it at ¥480.
    render(
      <CourseHero
        course={course()}
        totalCents={48_000}
        bookHref={null}
        currency="jpy"
        locale="en-US"
        t={t}
      />,
    );

    expect(screen.getByText(/¥48,000/)).toBeInTheDocument();
  });

  it("still reads as dollars for a usd shop", () => {
    render(
      <CourseHero
        course={course()}
        totalCents={48_000}
        bookHref={null}
        currency="usd"
        locale="en-US"
        t={t}
      />,
    );

    expect(screen.getByText(/\$480\b/)).toBeInTheDocument();
  });
});
