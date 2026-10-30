// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COURSE_TEMPLATES } from "@/content/course-templates";
import type { Course, Shop } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { courseTemplateSnapshot } from "@/lib/course-template-sync";

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

function requiredOpenWaterTemplate() {
  const template = COURSE_TEMPLATES.find((candidate) => candidate.slug === "open-water-diver");
  if (!template) throw new Error("Missing Open Water template");
  return template;
}

const openWaterTemplate = requiredOpenWaterTemplate();

function openWaterTemplateCourse(legacyVersion = false): Course {
  const latest = courseTemplateSnapshot(openWaterTemplate);
  const baseline = legacyVersion
    ? {
        ...latest,
        includes: latest.includes.map((item) =>
          item === "PADI certification fees"
            ? "All PADI learning materials and certification fees"
            : item,
        ),
      }
    : latest;
  return {
    ...course,
    summary: openWaterTemplate.content.summary,
    includes: baseline.includes,
    faqs: baseline.faqs,
    sourceTemplateSlug: openWaterTemplate.slug,
    sourceTemplateVersion: legacyVersion ? 3 : openWaterTemplate.version,
    sourceTemplateSnapshot: baseline,
  };
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

    const inquiryElement = container.querySelector<HTMLDetailsElement>("#get-in-touch");
    expect(inquiryElement?.tagName).toBe("DETAILS");
    expect(inquiryElement).not.toHaveAttribute("open");
    expect(inquiryElement?.querySelector("summary")).toHaveTextContent(t("course.askAnotherDate"));
    if (!inquiryElement) throw new Error("Missing alternate-date disclosure");
    const summary = inquiryElement.querySelector("summary");
    if (!summary) throw new Error("Missing alternate-date summary");
    fireEvent.click(summary);
    const inquiry = within(inquiryElement);
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
      for (const book of screen.getAllByRole("link", { name: t("course.bookThisDate") })) {
        expect(book).toHaveAttribute("href", "/s/blue-mantis/trips/trip-1");
      }
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
    await waitFor(() => expect(screen.getByText(t("inquiry.sentHeading"))).toBeInTheDocument());
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

describe("public Open Water template copy", () => {
  it.each([
    { locale: "en-US" as const, legacyVersion: false },
    { locale: "es-ES" as const, legacyVersion: false },
    { locale: "es-ES" as const, legacyVersion: true },
  ])("uses $locale copy for template-owned pricing text", async ({ locale, legacyVersion }) => {
    request.locale = locale;
    vi.mocked(shopBySlugCached).mockResolvedValue(shop(null, null));
    vi.mocked(getCourseBySlug).mockResolvedValue(openWaterTemplateCourse(legacyVersion));
    vi.mocked(listUpcomingSessionsForCourse).mockResolvedValue([]);
    const { container } = render(
      await CoursePage({
        params: Promise.resolve({ shopSlug: "blue-mantis", slug: "open-water-diver" }),
      }),
    );

    const t = diverTranslator(locale);
    const includedFees = t("course.templateCopy.openWaterCertificationFees");
    const faqQuestion = t("course.templateCopy.openWaterElearningQuestion");
    const faqAnswer = t("course.templateCopy.openWaterElearningAnswer");

    expect(screen.getByText(includedFees)).toBeInTheDocument();
    expect(screen.getAllByText(faqQuestion).length).toBeGreaterThan(0);
    expect(screen.getAllByText(faqAnswer).length).toBeGreaterThan(0);
    if (locale === "es-ES") {
      expect(screen.queryByText("PADI certification fees")).not.toBeInTheDocument();
      expect(
        screen.queryAllByText("All PADI learning materials and certification fees"),
      ).toHaveLength(0);
      expect(screen.queryByText("Can I do the theory before I arrive?")).not.toBeInTheDocument();
      expect(
        screen.queryAllByText(
          "Yes, and most students do. PADI eLearning is a separate fee, billed as its own line, and finishing it beforehand frees your days for diving.",
        ),
      ).toHaveLength(0);
    }
    expect(container.querySelector("#included")).toBeInTheDocument();
  });

  it("preserves shop-edited inclusion and FAQ text on the Spanish page", async () => {
    request.locale = "es-ES";
    const shopCopy = openWaterTemplateCourse();
    vi.mocked(shopBySlugCached).mockResolvedValue(shop(null, null));
    vi.mocked(getCourseBySlug).mockResolvedValue({
      ...shopCopy,
      includes: ["Curso incluye materiales seleccionados por el centro"],
      faqs: [
        {
          question: "¿Qué material debo traer?",
          answer: "El centro envía la lista al inscribirte.",
        },
      ],
    });
    vi.mocked(listUpcomingSessionsForCourse).mockResolvedValue([]);

    render(
      await CoursePage({
        params: Promise.resolve({ shopSlug: "blue-mantis", slug: "open-water-diver" }),
      }),
    );

    expect(
      screen.getByText("Curso incluye materiales seleccionados por el centro"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("¿Qué material debo traer?").length).toBeGreaterThan(0);
    expect(screen.getAllByText("El centro envía la lista al inscribirte.").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("Tarifas de certificación de PADI")).not.toBeInTheDocument();
  });
});
