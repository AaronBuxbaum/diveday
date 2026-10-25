// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, Shop } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

const request = vi.hoisted(() => ({ locale: "en-US" as DiverLocale }));

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/app/actions/inquiry", () => ({
  submitInquiryAction: vi.fn<typeof import("@/app/actions/inquiry").submitInquiryAction>(
    async () => ({ success: true }),
  ),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/courses", () => ({ getCourseBySlug: vi.fn() }));
vi.mock("@/db/shops-cached", () => ({ shopBySlugCached: vi.fn() }));
vi.mock("@/db/trips", () => ({ listUpcomingSessionsForCourse: vi.fn() }));
vi.mock("@/db/crew-away-diver", () => ({ diverCrewWithAway: vi.fn(async () => []) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/session", () => ({ isLiveShopStaff: vi.fn(async () => false) }));
vi.mock("@/i18n/request", () => ({
  requestTranslator: async () => ({
    locale: request.locale,
    t: diverTranslator(request.locale),
  }),
}));

const { submitInquiryAction } = await import("@/app/actions/inquiry");
const { getCourseBySlug } = await import("@/db/courses");
const { shopBySlugCached } = await import("@/db/shops-cached");
const { listUpcomingSessionsForCourse } = await import("@/db/trips");
const { default: CoursePage } = await import("./page");

const course: Course = {
  id: "course-1",
  shopId: "shop-1",
  slug: "open-water-diver",
  title: "Open Water Diver",
  agency: "padi",
  summary: null,
  overview: null,
  description: null,
  heroImageUrl: null,
  heroImageAlt: null,
  galleryPhotos: [],
  durationText: null,
  groupSizeText: null,
  minimumAge: 10,
  prerequisiteNote: null,
  includes: [],
  excludes: [],
  scheduleDays: [],
  learningMaterials: [],
  faqs: [],
  priceCents: null,
  eLearningPriceCents: null,
  privatePriceCents: null,
  minimumCertificationLevel: null,
  certifiesLevel: "open_water",
  isActive: true,
  isIntroCourse: false,
  nitroxCompatible: false,
  gearIncluded: false,
  rowVersion: 0,
  sourceTemplateSlug: null,
  sourceTemplateVersion: null,
  sourceTemplateSnapshot: null,
  createdAt: new Date("2030-08-01T12:00:00Z"),
};

function shop(contactEmail: string | null, contactPhone: string | null): Shop {
  return {
    id: "shop-1",
    slug: "blue-mantis",
    name: "Blue Mantis",
    timezone: "America/New_York",
    defaultLocale: request.locale,
    depthUnit: "meters",
    currency: "usd",
    contactEmail,
    contactPhone,
    reviewsEnabled: false,
    // This setting controls the general schedule request, not course inquiries.
    dateRequestsEnabled: false,
  } as Shop;
}

const scheduled = {
  id: "trip-1",
  title: "Open Water session",
  startsAt: new Date("2030-09-01T12:00:00Z"),
  endsAt: new Date("2030-09-01T16:00:00Z"),
  capacity: 6,
  booked: 1,
} as Awaited<ReturnType<typeof listUpcomingSessionsForCourse>>[number];

const scenarios = [
  { name: "no sessions or contact details", email: null, phone: null, hasSession: false },
  { name: "a scheduled session and no email", email: null, phone: null, hasSession: true },
  { name: "a phone-only shop", email: null, phone: "+1 305 555 0134", hasSession: false },
  { name: "a shop with an email", email: "hello@example.com", phone: null, hasSession: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCourseBySlug).mockResolvedValue(course);
});
afterEach(cleanup);

describe.each(["en-US", "es-ES"] as const)("public course requests in %s", (locale) => {
  it.each(scenarios)("accepts a request with $name", async ({ email, phone, hasSession }) => {
    request.locale = locale;
    const t = diverTranslator(locale);
    vi.mocked(shopBySlugCached).mockResolvedValue(shop(email, phone));
    vi.mocked(listUpcomingSessionsForCourse).mockResolvedValue(hasSession ? [scheduled] : []);
    const { container } = render(
      await CoursePage({
        params: Promise.resolve({ shopSlug: "blue-mantis", slug: "open-water-diver" }),
      }),
    );

    const inquiry = within(screen.getByRole("region", { name: t("inquiry.askAboutCourse") }));
    const jump = within(screen.getByRole("navigation", { name: t("course.onThisPage") }));
    expect(jump.getByRole("link", { name: t("course.jumpContact") })).toHaveAttribute(
      "href",
      "#get-in-touch",
    );
    expect(container.querySelector("[data-foot-bar] a")).toHaveAttribute(
      "href",
      hasSession ? "#dates" : "#get-in-touch",
    );
    if (hasSession) {
      expect(screen.getByRole("link", { name: t("course.bookThisDate") })).toHaveAttribute(
        "href",
        "/s/blue-mantis/trips/trip-1",
      );
    } else {
      expect(screen.getByRole("link", { name: t("course.orAskUs") })).toHaveAttribute(
        "href",
        "#get-in-touch",
      );
    }
    expect(inquiry.queryByRole("link", { name: "hello@example.com" }) !== null).toBe(
      Boolean(email),
    );
    expect(inquiry.queryByRole("link", { name: "+1 305 555 0134" }) !== null).toBe(Boolean(phone));

    fireEvent.change(inquiry.getByLabelText(t("inquiry.yourEmail")), {
      target: { value: "ana@example.com" },
    });
    fireEvent.click(inquiry.getByRole("button", { name: t("inquiry.send") }));
    await waitFor(() => expect(submitInquiryAction).toHaveBeenCalledOnce());
    expect(vi.mocked(submitInquiryAction).mock.calls[0]?.slice(0, 2)).toEqual([
      "blue-mantis",
      "open-water-diver",
    ]);
    await waitFor(() => expect(inquiry.getByText(t("inquiry.sentHeading"))).toBeInTheDocument());
  });

  it("keeps hidden courses unavailable to a signed-out diver", async () => {
    request.locale = locale;
    vi.mocked(shopBySlugCached).mockResolvedValue(shop(null, null));
    vi.mocked(getCourseBySlug).mockResolvedValue({ ...course, isActive: false });
    await expect(
      CoursePage({
        params: Promise.resolve({ shopSlug: "blue-mantis", slug: "open-water-diver" }),
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
