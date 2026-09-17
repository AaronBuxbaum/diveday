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
 * What the dive is and who it admits is owner/manager/instructor work (H-14,
 * ADR 20260724-role-authorization), and taking a course off the diver-facing
 * catalog — or putting it back on — is exactly that.
 *
 * Two halves, and only one of them is the gate: the control is not drawn for a
 * reader who may not use it, and the closure refuses the post regardless,
 * because a form that is not rendered is not a form that cannot be posted.
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
vi.mock("./_components/UnsavedChangesGuard", () => ({
  UnsavedChangesGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
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
  setCourseVisibility: vi.fn(),
}));
vi.mock("@/db/authz", () => ({ canPersonConfigureTrips: vi.fn() }));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/session", () => ({
  requireShopSurface: vi.fn(),
  requireStaffSession: vi.fn(),
}));
vi.mock("@/lib/storage/limits", () => ({
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

const { canPersonConfigureTrips } = await import("@/db/authz");
const { getCourseBySlug, getCourseTemplateUpdate, setCourseVisibility } = await import(
  "@/db/courses"
);
const { requireShopSurface, requireStaffSession } = await import("@/lib/session");
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

/**
 * The closure is not exported — it is the `action` of one form on the page —
 * so the test reaches it the way the browser does: off the element the page
 * returned. Walking the tree rather than the DOM, because React renders a
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
    shop: { id: SHOP_ID, slug: "blue-mantis", defaultLocale: "en-US", currency: "usd" },
  } as never);
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: SHOP_ID, shopSlug: "blue-mantis", personId: "staff" },
  } as never);
  vi.mocked(getCourseBySlug).mockResolvedValue(COURSE as never);
  vi.mocked(getCourseTemplateUpdate).mockResolvedValue(null as never);
  vi.mocked(setCourseVisibility).mockResolvedValue(COURSE as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the course editor's visibility toggle", () => {
  it("draws the control for a reader whose roles define trips", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    render(await renderPage());
    expect(
      screen.getByRole("button", { name: "courses.edit.hideFromCatalog" }),
    ).toBeInTheDocument();
  });

  /**
   * A crew member still edits the prose a diver reads — that is the rest of
   * this page. Only the one act they cannot take goes away, rather than the
   * whole editor.
   */
  it("draws no control for a reader whose roles do not", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(false);
    render(await renderPage());
    expect(
      screen.queryByRole("button", { name: "courses.edit.hideFromCatalog" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "courses.edit.showInCatalog" })).toBeNull();
    // The editor itself is untouched.
    expect(screen.getByRole("heading", { name: "Open Water Diver" })).toBeInTheDocument();
  });

  /**
   * The gate, as opposed to the drawing of it: a tab opened while the reader
   * still had the role, posted after it was taken away. The closure re-asks
   * live roles and refuses; the row never moves.
   */
  it("refuses the post from a role that may not define trips", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    const action = visibilityActionOf(await renderPage());
    expect(action).toBeTruthy();

    vi.mocked(canPersonConfigureTrips).mockResolvedValue(false);
    await expect(action?.()).rejects.toThrow(
      "REDIRECT:/shop/blue-mantis/courses/open-water-diver/edit?error=not-authorized",
    );
    expect(setCourseVisibility).not.toHaveBeenCalled();
  });

  /**
   * **The live row decides the flip.** Closing over the render's `isActive`
   * meant a tab left open while a colleague hid the course posted "hide it"
   * again and put it back on the diver-facing catalog.
   */
  it("flips the standing the row has now, not the one the page was rendered with", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    const action = visibilityActionOf(await renderPage());

    // Somebody else hid it between the render and the tap.
    vi.mocked(getCourseBySlug).mockResolvedValue({ ...COURSE, isActive: false } as never);
    await action?.();

    expect(setCourseVisibility).toHaveBeenCalledWith({}, SHOP_ID, COURSE_ID, true);
  });

  /** A slug that no longer names the course this page was rendered for. */
  it("refuses when the slug has moved to another course", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    const action = visibilityActionOf(await renderPage());

    vi.mocked(getCourseBySlug).mockResolvedValue({ ...COURSE, id: "other-course" } as never);
    await expect(action?.()).rejects.toThrow("NOT_FOUND");
    expect(setCourseVisibility).not.toHaveBeenCalled();
  });
});
