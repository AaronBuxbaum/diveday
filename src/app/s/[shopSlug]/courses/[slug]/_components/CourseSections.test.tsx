// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Course } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import { CourseGallery, CourseHero, CourseSessions } from "./CourseSections";

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
    galleryPhotos: [],
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

describe("the public h1 joins the display scale", () => {
  /**
   * ADR 20260827-clearwater-surface-language, decision 8, resolves the
   * `text-2xl`/`text-4xl` disagreement between `/s/[shopSlug]` and its course
   * pages **upward**. Nothing else on this page changed in that slice, which is
   * why this is the only assertion it gets.
   */
  it("renders the course title as the page title, not as a section heading", () => {
    render(<CourseHero course={course()} totalCents={null} currency="usd" locale="en-US" t={t} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Open Water Diver");
    expect(heading.className).toContain("text-4xl");
    expect(heading.className).not.toContain("text-2xl");
  });
});

describe("CourseHero price currency (task 35)", () => {
  it("renders the shop's own currency rather than dollars", () => {
    render(
      <CourseHero course={course()} totalCents={480_000} currency="mxn" locale="en-US" t={t} />,
    );

    expect(screen.getByText(/MX\$4,800/)).toBeInTheDocument();
    expect(screen.queryByText(/^\$4,800/)).not.toBeInTheDocument();
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    // JPY stores whole yen: a ¥48,000 course is `48000`, and a literal
    // `/ 100` would advertise it at ¥480.
    render(
      <CourseHero course={course()} totalCents={48_000} currency="jpy" locale="en-US" t={t} />,
    );

    expect(screen.getByText(/¥48,000/)).toBeInTheDocument();
  });

  it("still reads as dollars for a usd shop", () => {
    render(
      <CourseHero course={course()} totalCents={48_000} currency="usd" locale="en-US" t={t} />,
    );

    expect(screen.getByText(/\$480\b/)).toBeInTheDocument();
  });
});

/**
 * A caption belongs to the photo it was written for, and there is no longer a
 * shape in which it can slide onto a neighbour: the gallery is one object per
 * photo rather than the `imageUrls`/`imageAlts` pair it replaced, where a
 * length mismatch silently shifted every caption after it (DATA-L4, review
 * 20260802). This is the surface that defect was invisible on — the words only
 * a screen reader hears.
 */
describe("CourseGallery captions (DATA-L4)", () => {
  it("gives each photo the caption written for it", () => {
    render(
      <CourseGallery
        photos={[
          { url: "/a.jpg", alt: "Fitting a mask in the shallows" },
          { url: "/b.jpg", alt: "Surfacing at the mooring line" },
        ]}
        title="Open Water Diver"
        t={t}
      />,
    );

    expect(screen.getByAltText("Fitting a mask in the shallows")).toBeInTheDocument();
    expect(screen.getByAltText("Surfacing at the mooring line")).toBeInTheDocument();
  });

  it("falls back to a generated caption for an uncaptioned photo without borrowing its neighbour's", () => {
    // The old shape's failure mode: an early blank pulled every later caption
    // up a slot, so this photo would have read "Surfacing at the mooring line".
    render(
      <CourseGallery
        photos={[
          { url: "/a.jpg", alt: "" },
          { url: "/b.jpg", alt: "Surfacing at the mooring line" },
        ]}
        title="Open Water Diver"
        t={t}
      />,
    );

    // The hero photo claims "photo 1", so the gallery starts at 2.
    expect(screen.getByAltText("Open Water Diver — photo 2")).toBeInTheDocument();
    expect(screen.getByAltText("Surfacing at the mooring line")).toBeInTheDocument();
  });

  it("renders nothing at all when the shop has published no gallery", () => {
    const { container } = render(<CourseGallery photos={[]} title="Open Water Diver" t={t} />);

    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The featured slot in the booking panel answers "when can I start?", so it
 * holds the soonest *bookable* session — featuring a full one would put a
 * waitlist in the page's most prominent slot (and leave the page with no
 * primary action) while an open date hid in a compact row below.
 */
describe("CourseSessions featured date", () => {
  function session(overrides: Partial<Parameters<typeof CourseSessions>[0]["sessions"][number]>) {
    return {
      id: "trip-1",
      title: "Open Water Diver",
      startsAt: new Date("2026-07-30T13:00:00Z"),
      endsAt: new Date("2026-08-01T22:00:00Z"),
      capacity: 6,
      booked: 0,
      ...overrides,
    };
  }
  const props = {
    shopSlug: "blue-mantis",
    timezone: "America/New_York",
    locale: "en-US",
    inquiryHref: null,
    t,
  };

  it("features the soonest session when it is open, as the page's one primary", () => {
    render(
      <CourseSessions
        sessions={[
          session({ id: "trip-1", booked: 2 }),
          session({ id: "trip-2", startsAt: new Date("2026-08-06T13:00:00Z"), booked: 0 }),
        ]}
        {...props}
      />,
    );

    expect(screen.getByText("Next date")).toBeInTheDocument();
    const [featured] = screen.getAllByRole("link", { name: "Book this date" });
    expect(featured).toHaveAttribute("href", "/s/blue-mantis/trips/trip-1");
  });

  it("skips past a full soonest session to feature the first open one, honestly labelled", () => {
    render(
      <CourseSessions
        sessions={[
          session({ id: "trip-full", booked: 6 }),
          session({ id: "trip-open", startsAt: new Date("2026-08-06T13:00:00Z"), booked: 1 }),
        ]}
        {...props}
      />,
    );

    // The open date owns the featured slot, labelled so the slot never claims
    // the full earlier date doesn't exist…
    expect(screen.getByText("Next open date")).toBeInTheDocument();
    expect(screen.queryByText("Next date")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book this date" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/trips/trip-open",
    );
    // …and the skipped full session still shows, as a waitlist row beneath.
    expect(screen.getByRole("link", { name: "Join the wait list" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/trips/trip-full",
    );
  });

  it("falls back to the soonest session's waitlist when every date is full", () => {
    render(<CourseSessions sessions={[session({ id: "trip-full", booked: 6 })]} {...props} />);

    expect(screen.getByText("Next date")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join the wait list" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/trips/trip-full",
    );
    expect(screen.queryByRole("link", { name: "Book this date" })).not.toBeInTheDocument();
  });

  it("renders the public empty-state when there are no public sessions", () => {
    render(<CourseSessions sessions={[]} {...props} inquiryHref={null} />);

    expect(
      screen.getByText(/No dates on the books right now — this course runs on request/),
    ).toBeInTheDocument();
  });
});
