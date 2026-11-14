// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **"Is this course for sale" is trip-definition work.**
 *
 * The visibility toggle was gated on `requireStaffSession()` alone, which is
 * "somebody at this shop is signed in" — the same gate the roster control it
 * replaced had, so this is not a widening, but it is not the right one either.
 * What the dive is and who it admits is owner/manager/instructor work (H-20260724-staff-role-reach,
 * ADR 20260724-role-authorization), and taking a course off the diver-facing
 * catalog — or putting it back on — is exactly that.
 *
 * Two halves, and only one of them is the gate: the control is not drawn for a
 * reader who may not use it (here), and `setCourseVisibilityAction` refuses the
 * post regardless (`actions.test.ts`), because a form that is not rendered is
 * not a form that cannot be posted.
 */

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/components/FlashParams", () => ({ FlashParams: () => null }));
vi.mock("@/components/ImageFileInput", () => ({ ImageFileInput: () => null }));
vi.mock("@/components/StoredPhoto", () => ({ StoredPhoto: () => null }));
vi.mock("@/components/ShopPageHeader", () => ({
  ShopNotice: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ShopPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/ui/FieldErrorFocus", () => ({ FieldErrorFocus: () => null }));
vi.mock("./_components/DayByDayEditor", () => ({ DayByDayEditor: () => null }));
vi.mock("./_components/FaqEditor", () => ({ FaqEditor: () => null }));
vi.mock("./_components/LearningMaterialsEditor", () => ({ LearningMaterialsEditor: () => null }));
vi.mock("./_components/UnsavedChangesGuard", () => ({
  UnsavedChangesGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
  UnsavedChangesNote: () => null,
}));
vi.mock("./actions", () => ({
  pullCourseTemplateUpdatesAction: vi.fn(),
  saveCourseContentAction: vi.fn(),
  saveCourseFormRequirementsAction: vi.fn(),
  setCourseVisibilityAction: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/course-forms", () => ({
  listCourseForms: vi.fn(async () => []),
  listCourseFormRequirements: vi.fn(async () => []),
  listCourseFormAgeBounds: vi.fn(async () => new Map()),
  courseUpcomingEnrollment: vi.fn(async () => ({ students: 0, sessions: 0 })),
}));
vi.mock("../../../../../../features/courses/store", () => ({
  getCourseBySlug: vi.fn(),
  courseIdsEverOnBoard: vi.fn(async () => new Set<string>()),
  getCourseTemplateUpdate: vi.fn(),
}));
vi.mock("@/db/authz", () => ({
  canPersonEditCourseTemplates: vi.fn(),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("../../../../../../features/session/rules", () => ({
  requireShopSurface: vi.fn(),
  requireStaffSession: vi.fn(),
}));
vi.mock("@/lib/storage/limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/limits")>()),
  MAX_IMAGE_MB: 5,
  MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION: 8,
}));
vi.mock("@/i18n/staff-messages", () => ({
  staffTranslator: () =>
    Object.assign((key: string) => key, {
      raw: (key: string) => key,
      rich: (key: string) => key,
    }),
}));

const { canPersonEditCourseTemplates } = await import("@/db/authz");
const { getCourseBySlug, getCourseTemplateUpdate } = await import(
  "../../../../../../features/courses/store"
);
const { setCourseVisibilityAction } = await import("./actions");
const { requireShopSurface, requireStaffSession } = await import(
  "../../../../../../features/session/rules"
);
const { default: EditCoursePage } = await import("./page");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const COURSE_ID = "11111111-1111-4111-8111-111111111111";
const COURSE = {
  id: COURSE_ID,
  shopId: SHOP_ID,
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
  learningMaterials: [],
  priceCents: 49900,
  eLearningPriceCents: null,
  minimumCertificationLevel: null,
  isActive: true,
  isIntroCourse: false,
  nitroxCompatible: true,
  includedRentalKinds: [],
  sourceTemplateSlug: "open-water-diver",
  sourceTemplateVersion: 1,
  sourceTemplateSnapshot: {},
  createdAt: new Date("2026-08-01T00:00:00Z"),
};

/**
 * The bound action is the `action` of one form on the page, so the test
 * reaches it the way the browser does: off the element the page returned. Walking the tree rather than the DOM, because React renders a
 * function `action` as its own transport and the attribute is not the
 * function.
 */
function visibilityActionOf(node: ReactNode): (() => Promise<void>) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = visibilityActionOf(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { action?: unknown; children?: ReactNode };
  if (node.type === "form" && typeof props.action === "function") {
    return props.action as () => Promise<void>;
  }
  return visibilityActionOf(props.children ?? null);
}

async function renderPage() {
  return EditCoursePage({
    params: Promise.resolve({ shopSlug: "blue-mantis", slug: "open-water-diver" }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { shopId: SHOP_ID, shopSlug: "blue-mantis", personId: "staff" } },
    db: {},
    shop: {
      id: SHOP_ID,
      slug: "blue-mantis",
      defaultLocale: "en-US",
      currency: "usd",
      rentalItems: ["bcd"],
    },
  } as never);
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: SHOP_ID, shopSlug: "blue-mantis", personId: "staff" },
  } as never);
  vi.mocked(getCourseBySlug).mockResolvedValue(COURSE as never);
  vi.mocked(getCourseTemplateUpdate).mockResolvedValue(null as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the course editor's visibility toggle", () => {
  it("draws the control for an owner or manager", async () => {
    vi.mocked(canPersonEditCourseTemplates).mockResolvedValue(true);
    render(await renderPage());
    expect(
      screen.getByRole("button", { name: "courses.edit.hideFromCatalog" }),
    ).toBeInTheDocument();
  });

  /**
   * Anyone who runs a course may schedule it; only an owner or manager
   * rewrites it. The editor is not drawn for anyone else: a published course
   * lands them on the board with it preselected.
   */
  it("sends a reader who may not edit templates to the board with this course", async () => {
    vi.mocked(canPersonEditCourseTemplates).mockResolvedValue(false);
    await expect(renderPage()).rejects.toThrow(
      `REDIRECT:/shop/blue-mantis/schedule/board?course=${COURSE_ID}`,
    );
  });

  /**
   * The gate itself is `setCourseVisibilityAction`'s, pinned in
   * `actions.test.ts`. What the page owns is the wiring: the form posts that
   * action with the slug and the id it rendered, and nothing the reader typed.
   */
  it("binds the toggle to this course's slug and id", async () => {
    vi.mocked(canPersonEditCourseTemplates).mockResolvedValue(true);
    const action = visibilityActionOf(await renderPage());
    expect(action).toBeTruthy();

    await action?.();
    expect(setCourseVisibilityAction).toHaveBeenCalledWith("open-water-diver", COURSE_ID);
  });
});
