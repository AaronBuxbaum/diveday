// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Course } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import type { PaperShop } from "../../../_components/PublicPaperSheet";
import { CoursePaperSheet } from "./CoursePaperSheet";
import { CourseAdmission, type CourseSession } from "./CourseSections";

afterEach(cleanup);

const t = diverTranslator("en-US");

const SHOP: PaperShop = {
  name: "Blue Mantis Divers",
  timezone: "America/New_York",
  contactPhone: "+1 305 555 0100",
  contactEmail: null,
  addressStreet: "100 Ocean Drive",
  addressLocality: "Key Largo",
  addressRegion: "FL",
  addressPostalCode: null,
  addressCountry: null,
};

function course(overrides: Partial<Course> = {}): Course {
  return {
    slug: "open-water",
    title: "Open Water Diver",
    agency: "padi",
    isActive: true,
    summary: "Your first certification.",
    privatePriceCents: 0,
    isIntroCourse: false,
    overview: "Three days.\n\nTwo in the pool.",
    groupSizeText: "Four students per instructor",
    scheduleDays: [
      { title: "Day 1 · Pool", startTime: "08:00", endTime: "12:00", items: ["Skills"] },
    ],
    includes: ["Rental gear"],
    excludes: ["Certification fee"],
    faqs: [
      { question: "Do I need to swim?", answer: "Two hundred metres, any stroke." },
      { question: "Can I fly after?", answer: "Wait at least 18 hours." },
    ],
    ...overrides,
  } as unknown as Course;
}

const SESSIONS: CourseSession[] = [
  {
    id: "s1",
    title: "Open Water — March",
    startsAt: new Date("2027-03-06T13:00:00Z"),
    endsAt: new Date("2027-03-08T21:00:00Z"),
    capacity: 4,
    booked: 4,
    instructors: ["Maya"],
  },
  {
    id: "s2",
    title: "Open Water — July",
    startsAt: new Date("2027-07-10T12:00:00Z"),
    endsAt: new Date("2027-07-10T20:00:00Z"),
    capacity: 4,
    booked: 1,
  },
];

function sheet(subject: Course, sessions: CourseSession[] = SESSIONS) {
  return render(
    <CoursePaperSheet
      shop={SHOP}
      shopSlug="blue-mantis"
      course={subject}
      totalCents={49_900}
      currency="usd"
      facts={[{ label: t("course.duration"), value: "3 days" }]}
      admission={
        <CourseAdmission
          certificationRequired={t("course.noCertification")}
          minimumAge={10}
          shopNote={null}
          t={t}
        />
      }
      sessions={sessions}
      locale="en-US"
      t={t}
      now={new Date("2026-11-06T12:00:00Z")}
    />,
  );
}

describe("a course on paper", () => {
  it("is shown only to the printer, and nothing on it taps", () => {
    const { container } = sheet(course());
    const frame = container.querySelector(".paper-sheet-frame");
    expect(frame?.hasAttribute("data-paper-print-only")).toBe(true);
    expect(
      container.querySelectorAll("a, button, input, select, textarea, details, img"),
    ).toHaveLength(0);
  });

  it("prints every question with its answer, never a closed disclosure", () => {
    const text = sheet(course()).container.textContent ?? "";
    expect(text).toContain("Do I need to swim?");
    expect(text).toContain("Two hundred metres, any stroke.");
    expect(text).toContain("Wait at least 18 hours.");
  });

  it("states the price, admission, plan and what the fee covers", () => {
    const text = sheet(course()).container.textContent ?? "";
    expect(text).toContain("$499");
    expect(text).toContain(t("course.agesAndUp", { age: 10 }));
    expect(text).toContain("Duration: 3 days");
    expect(text).toContain("Four students per instructor");
    expect(text).toContain("Day 1 · Pool");
    expect(text).toContain("Rental gear");
    expect(text).toContain("Certification fee");
    expect(text).toContain("Two in the pool.");
  });

  it("gives every date its year, its zone and its seats", () => {
    const text = sheet(course()).container.textContent ?? "";
    expect(text).toMatch(/Mar\s6, 2027 – Mar\s8, 2027/);
    expect(text).toMatch(/Starts 8:00\sAM\sEST/);
    expect(text).toContain("Full");
    expect(text).toContain("With Maya");
    expect(text).toMatch(/Jul\s10, 2027/);
    expect(text).toMatch(/EDT · 3 seats/);
  });

  it("says when no date is on the books", () => {
    const text = sheet(course(), []).container.textContent ?? "";
    expect(text).toContain(t("course.noDatesLead"));
  });

  it("says a hidden course is hidden, so a printed preview is never read as on sale", () => {
    expect(sheet(course()).container.textContent).not.toContain(t("course.hidden"));
    expect(sheet(course({ isActive: false })).container.textContent).toContain(t("course.hidden"));
  });

  it("carries the shop's number and street as words", () => {
    const text = sheet(course()).container.textContent ?? "";
    expect(text).toContain("+1 305 555 0100");
    expect(text).toContain("100 Ocean Drive, Key Largo, FL");
    expect(text).toContain("/s/blue-mantis/courses/open-water");
  });
});
