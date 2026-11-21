// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, Shop } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";

/**
 * **The medical questions, read before booking** (issue #4329). The same
 * questions the waiver asks, read-only: nothing is collected, each question
 * says what a yes means in the waiver's terms, and a course the public cannot
 * see has no questions page either.
 */

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/s/blue-mantis/courses/discover-scuba/medical-questions",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((href: string) => {
    throw new Error(`REDIRECT ${href}`);
  }),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("../../../../../../features/training/courses/store", () => ({ getCourseBySlug: vi.fn() }));
vi.mock("../../../../../../features/platform/shops-cached", () => ({ shopBySlugCached: vi.fn() }));
vi.mock("@/i18n/request", () => ({
  requestTranslator: async () => ({ locale: "en-US", t: diverTranslator("en-US") }),
}));

const { getCourseBySlug } = await import("../../../../../../features/training/courses/store");
const { shopBySlugCached } = await import("../../../../../../features/platform/shops-cached");
const { default: CourseMedicalQuestionsPage } = await import("./page");

const t = diverTranslator("en-US");
const shop = {
  id: "shop-1",
  slug: "blue-mantis",
  name: "Blue Mantis",
  defaultLocale: "en-US",
  coursesEnabled: true,
  jurisdiction: "rstc",
} as Shop;
const course = {
  id: "course-1",
  slug: "discover-scuba",
  title: "Discover Scuba Diving",
  isActive: true,
} as Course;

const params = Promise.resolve({ shopSlug: "blue-mantis", slug: "discover-scuba" });

beforeEach(() => {
  vi.mocked(shopBySlugCached).mockResolvedValue(shop as never);
  vi.mocked(getCourseBySlug).mockResolvedValue(course as never);
});
afterEach(cleanup);

describe("the course's medical questions page", () => {
  it("lists the ten questions and collects nothing", async () => {
    const { container } = render(await CourseMedicalQuestionsPage({ params }));

    expect(screen.getByRole("heading", { name: t("course.medicalQuestions.title") })).toBeVisible();
    const list = screen.getAllByRole("list")[0];
    if (!list) throw new Error("no question list");
    expect(within(list).getByText("I am over 45 years of age.")).toBeInTheDocument();
    expect(list.querySelectorAll(":scope > li")).toHaveLength(10);
    expect(container.querySelector("form, input, textarea, select, button")).toBeNull();
    expect(screen.getByRole("link", { name: /Discover Scuba Diving/ })).toHaveAttribute(
      "href",
      "/s/blue-mantis/courses/discover-scuba",
    );
  });

  it("says a yes to an asterisked question means a doctor, and a yes to the others opens follow-ups", async () => {
    const { container } = render(await CourseMedicalQuestionsPage({ params }));
    const items = [...container.querySelectorAll("ul > li")];
    const exercise = items.find((item) => item.textContent?.includes("moderate exercise"));
    const lungs = items.find((item) => item.textContent?.includes("problems with my lungs"));

    expect(exercise?.textContent).toContain(t("course.medicalQuestions.yesNeedsDoctor"));
    expect(exercise?.textContent).not.toContain(t("course.medicalQuestions.followUps"));
    expect(lungs?.textContent).toContain(t("course.medicalQuestions.yesOpensFollowUps"));
    // The asthma a first-timer means to mention sits under the lungs question.
    const followUps = lungs?.querySelector("details")?.textContent;
    expect(followUps).toMatch(/asthma/i);
    expect(followUps).toContain(t("course.medicalQuestions.followUpsNeedDoctor"));
  });

  it("is not found for a hidden course", async () => {
    vi.mocked(getCourseBySlug).mockResolvedValue({ ...course, isActive: false } as never);
    await expect(CourseMedicalQuestionsPage({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("is not found for a course that does not exist", async () => {
    vi.mocked(getCourseBySlug).mockResolvedValue(null as never);
    await expect(CourseMedicalQuestionsPage({ params })).rejects.toThrow("NOT_FOUND");
  });
});
