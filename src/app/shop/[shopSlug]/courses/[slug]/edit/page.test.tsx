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
vi.mock("./_components/LearningMaterialsEditor", () => ({ LearningMaterialsEditor: () => null }));
vi.mock("./_components/UnsavedChangesGuard", () => ({
  UnsavedChangesGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  UnsavedChangesNote: () => null,
}));
vi.mock("./actions", () => ({
  pullCourseTemplateUpdatesAction: vi.fn(),
  saveCourseContentAction: vi.fn(),
  saveCourseFormRequirementsAction: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/course-forms", () => ({
  listCourseForms: vi.fn(async () => []),
  listCourseFormRequirements: vi.fn(async () => []),
}));
// The page asks live roles whether to draw the visibility toggle; this suite is
// about the template panel and the editor rail, so the answer is stubbed rather
// than seeded. The gate itself is pinned in `page.authz.test.tsx`.
vi.mock("@/db/authz", () => ({
  canPersonConfigureTrips: vi.fn(async () => true),
  canPersonManageWaiverTemplates: vi.fn(async () => true),
}));
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

/**
 * **The nitrox box sits with the fields above it and its own hint under it**
 * (docs/design/pixel-craft.md, class 4; K-414). Its row carried `mt-5` inside
 * a section whose fields already stand `gap-5` apart, so it sat 40px under the
 * Duration box where every sibling sits 20px; and its hint was a sibling of
 * its own in that gap, 42px under the box, where every other hint on the page
 * sits 4px under its control. Moved under the row, the hint still hung from
 * the row's 44px target, about 23px under the 16px box, and at 14px where
 * every other helper on the editor is a `Field` description's 12px (class 12).
 */
describe("EditCoursePage nitrox box", () => {
  it("keeps the section's field gap and carries its hint, wired to the box", async () => {
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: { user: { shopId: COURSE.shopId, shopSlug: "blue-mantis", personId: "staff" } },
      db: {},
      shop: { id: COURSE.shopId, slug: "blue-mantis", defaultLocale: "en-US", currency: "usd" },
    } as never);
    vi.mocked(getCourseBySlug).mockResolvedValue(COURSE as never);
    vi.mocked(getCourseTemplateUpdate).mockResolvedValue(null as never);
    render(
      await EditCoursePage({
        params: Promise.resolve({ shopSlug: "blue-mantis", slug: "open-water-diver" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const box = screen.getByRole("checkbox", { name: "courses.edit.nitroxCompatibleLabel" });
    const row = box.closest("label");
    const hint = screen.getByText("courses.edit.nitroxCompatibleHint");
    expect(row).not.toHaveClass("mt-5");
    // The hint is the next line of the box's own words, in their column, at a
    // description's size: not a paragraph under the row's 44px target.
    expect(hint.parentElement).toBe(
      screen.getByText("courses.edit.nitroxCompatibleLabel").parentElement,
    );
    expect(row).toContainElement(hint);
    expect(hint).toHaveClass("text-xs", "text-muted");
    expect(hint).not.toHaveClass("text-sm", "mt-1");
    // Inside the label, and still the box's description rather than its name.
    expect(box).toHaveAccessibleName("courses.edit.nitroxCompatibleLabel");
    expect(box).toHaveAccessibleDescription("courses.edit.nitroxCompatibleHint");
  });
});
