// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/components/FlashParams", () => ({ FlashParams: () => null }));
vi.mock("@/components/ImageFileInput", () => ({ ImageFileInput: () => null }));
vi.mock("@/components/StoredPhoto", () => ({ StoredPhoto: () => null }));
vi.mock("@/components/ShopPageHeader", () => ({
  ShopNotice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ShopPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/ui/FieldErrorFocus", () => ({ FieldErrorFocus: () => null }));
vi.mock("./_components/DayByDayEditor", () => ({ DayByDayEditor: () => null }));
vi.mock("./_components/FaqEditor", () => ({ FaqEditor: () => null }));
vi.mock("./_components/UnsavedChangesGuard", () => ({
  UnsavedChangesGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  UnsavedChangesNote: () => null,
}));
vi.mock("./actions", () => ({
  pullCourseTemplateUpdatesAction: vi.fn(),
  saveCourseContentAction: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/courses", () => ({
  getCourseBySlug: vi.fn(),
  getCourseTemplateUpdate: vi.fn(),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/storage/limits", () => ({
  MAX_IMAGE_MB: 5,
  MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION: 8,
}));
vi.mock("@/i18n/staff-messages", () => ({
  staffTranslator: () => {
    return Object.assign((key: string) => key, {
      raw: (key: string) => key,
      rich: (key: string) => key,
    });
  },
}));

const { getCourseBySlug, getCourseTemplateUpdate } = await import("@/db/courses");
const { requireShopSurface } = await import("@/lib/session");
const { default: EditCoursePage } = await import("./page");

const COURSE = {
  id: "11111111-1111-4111-8111-111111111111",
  shopId: "22222222-2222-4222-8222-222222222222",
  title: "Open Water Diver",
  slug: "open-water-diver",
  agency: "padi",
  description: "The foundational course.",
  summary: "Learn to dive",
  overview: "Overview",
  heroImageUrl: null,
  heroImageAlt: null,
  galleryPhotos: [],
  durationText: "3 days",
  groupSizeText: "8 students",
  minimumAge: 10,
  prerequisiteNote: "None",
  includes: ["Gear"],
  excludes: [],
  scheduleDays: [],
  faqs: [],
  priceCents: 49900,
  eLearningPriceCents: null,
  minimumCertificationLevel: null,
  isActive: true,
  isIntroCourse: false,
  nitroxCompatible: true,
  sourceTemplateSlug: "open-water-diver",
  sourceTemplateVersion: 1,
  sourceTemplateSnapshot: {},
  createdAt: new Date("2026-08-01T00:00:00Z"),
};

afterEach(() => cleanup());

describe("EditCoursePage template update panel", () => {
  it("shows the diff and both explicit update choices", async () => {
    // One mock where there were two: the page opens with requireShopSurface,
    // which resolves the session, the db handle and the shop row together and
    // 404s a slug that is not this session's shop.
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: { user: { shopId: COURSE.shopId, shopSlug: "blue-mantis", personId: "staff" } },
      db: {},
      shop: { id: COURSE.shopId, slug: "blue-mantis", defaultLocale: "en-US", currency: "usd" },
    } as never);
    vi.mocked(getCourseBySlug).mockResolvedValue(COURSE as never);
    vi.mocked(getCourseTemplateUpdate).mockResolvedValue({
      currentVersion: 1,
      latestVersion: 2,
      diff: [
        { field: "summary", shopChanged: false },
        { field: "overview", shopChanged: true },
      ],
    } as never);

    const page = await EditCoursePage({
      params: Promise.resolve({ shopSlug: "blue-mantis", slug: "open-water-diver" }),
      searchParams: Promise.resolve({}),
    });
    render(page);

    expect(screen.getByText("courses.edit.templateUpdates.title")).toBeInTheDocument();
    expect(screen.getByText("courses.edit.templateUpdates.fields.summary")).toBeInTheDocument();
    expect(screen.getByText("courses.edit.templateUpdates.fields.overview")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "courses.edit.templateUpdates.keepEdits" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "courses.edit.templateUpdates.replaceCopy" }),
    ).toHaveAttribute("aria-busy", "false");
  });
});

/**
 * The editor rail's pin — ADR 20260827-the-shops-shelves, decision 2: *every
 * section reachable from the rail*, and the refusal anchors still landing.
 *
 * Stated against the real page rather than against a fixture list, because the
 * failure this catches is a section added to the form and forgotten in the
 * rail (unreachable on a four-thousand-pixel page) or a rail entry whose
 * section was renamed (an anchor that jumps nowhere). Both render fine.
 */
describe("EditCoursePage editor rail", () => {
  async function renderEditor() {
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: { user: { shopId: COURSE.shopId, shopSlug: "blue-mantis", personId: "staff" } },
      db: {},
      shop: { id: COURSE.shopId, slug: "blue-mantis", defaultLocale: "en-US", currency: "usd" },
    } as never);
    vi.mocked(getCourseBySlug).mockResolvedValue(COURSE as never);
    vi.mocked(getCourseTemplateUpdate).mockResolvedValue(null as never);
    return render(
      await EditCoursePage({
        params: Promise.resolve({ shopSlug: "blue-mantis", slug: "open-water-diver" }),
        searchParams: Promise.resolve({}),
      }),
    );
  }

  it("lands every one of its anchors on a section of this form", async () => {
    const { container } = await renderEditor();
    const rail = screen.getByRole("navigation", { name: "courses.edit.sectionsLabel" });
    const targets = within(rail)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");

    expect(targets.length).toBeGreaterThan(3);
    for (const target of targets) {
      expect(
        container.querySelector(`${target}[data-editor-section]`),
        `${target} names no section of the form`,
      ).not.toBeNull();
    }
    // And nothing sectioned is missing from the rail: a section the writer can
    // scroll to but not jump to is the same defect from the other side.
    const rendered = [...container.querySelectorAll("[data-editor-section]")].map(
      (section) => `#${section.id}`,
    );
    expect(rendered).toEqual(targets);
  });

  it("keeps the id a refused day-by-day save is sent back to", async () => {
    // `saveCourseContentAction` redirects with `?field=scheduleDaysJson`, which
    // `FieldErrorFocus` resolves through `document.getElementById`. Renaming
    // this section's id would break the refusal silently.
    const { container } = await renderEditor();
    expect(container.querySelector("#scheduleDaysJson")).not.toBeNull();
    expect(screen.getByRole("link", { name: "courses.edit.dayByDayLegend" })).toHaveAttribute(
      "href",
      "#scheduleDaysJson",
    );
  });
});
