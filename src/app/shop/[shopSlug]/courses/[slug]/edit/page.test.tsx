// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
vi.mock("./_components/UnsavedChangesGuard", () => ({
  UnsavedChangesGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
