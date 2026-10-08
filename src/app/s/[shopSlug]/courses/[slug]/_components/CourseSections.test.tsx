// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Course } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import {
  CourseGallery,
  CourseHero,
  CourseSchedule,
  CourseSessions,
  courseFootBar,
} from "./CourseSections";

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
    expect(heading.className).toContain("text-[2.5rem]");
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

describe("CourseHero private course", () => {
  it("says a private course is available, and links to asking the shop", () => {
    render(
      <CourseHero
        course={course({ privatePriceCents: 90_000 })}
        totalCents={48_000}
        currency="usd"
        locale="en-US"
        t={t}
        inquiryHref="#get-in-touch"
      />,
    );

    expect(screen.getByText(/Private course available/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask the shop" })).toHaveAttribute(
      "href",
      "#get-in-touch",
    );
    // Per diver or per group is the shop's to explain; the price never shows.
    expect(screen.queryByText(/\$900/)).not.toBeInTheDocument();
  });

  it("names no door when the shop has no inbox", () => {
    render(
      <CourseHero
        course={course({ privatePriceCents: 90_000 })}
        totalCents={null}
        currency="usd"
        locale="en-US"
        t={t}
      />,
    );

    expect(screen.getByText("Private course available")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ask the shop" })).not.toBeInTheDocument();
  });

  it("calls a private intro a session, since a taster is not a course", () => {
    render(
      <CourseHero
        course={course({ privatePriceCents: 30_000, isIntroCourse: true })}
        totalCents={null}
        currency="usd"
        locale="en-US"
        t={t}
      />,
    );

    expect(screen.getByText("Private session available")).toBeInTheDocument();
    expect(screen.queryByText("Private course available")).not.toBeInTheDocument();
  });

  it("says nothing when the course has no private price", () => {
    render(
      <CourseHero course={course()} totalCents={48_000} currency="usd" locale="en-US" t={t} />,
    );

    expect(screen.queryByText(/Private course/)).not.toBeInTheDocument();
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

  it("falls back to a generated caption for an uncaptioned photo without borrowing its neighbor's", () => {
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
 * The day-by-day timeline: a ring on a rail beside each day's title.
 */
describe("CourseSchedule's day marks", () => {
  const days = [
    { title: "Day 1 — theory and pool", items: ["Knowledge review"] },
    { title: "Day 2 — confined water and first open water", items: [] },
  ];

  /**
   * **The ring is centred on its title's line** (pixel-craft class 2, K-562).
   * The 11px ring beside a 28px `text-lg` line sat at 6px, 2px above the
   * title's cap centre; at 8px its centre is the caps', and it starts where
   * the rail behind it starts.
   */
  it("hangs each day's ring 8px down, where the rail starts", () => {
    const { container } = render(<CourseSchedule days={days} locale="en-US" t={t} />);

    const rail = container.querySelector("#how-it-runs .relative > span[aria-hidden]");
    expect(rail?.className).toMatch(/\btop-2\b/);
    const rings = Array.from(container.querySelectorAll("#how-it-runs li > span[aria-hidden]"));
    expect(rings).toHaveLength(2);
    for (const ring of rings) {
      expect(ring.className).toMatch(/\btop-2\b/);
      expect(ring.className).not.toMatch(/\btop-1\.5\b/);
    }
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

  it("skips past a full soonest session to feature the first open one, honestly labeled", () => {
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
      screen.getByText(/No dates on the books right now. This course runs on request/),
    ).toBeInTheDocument();
  });

  /**
   * **The panel's corner is on the ladder** (pixel-craft class 6, K-378). It
   * was `rounded-3xl`, 24px, a rung the ladder does not have, under a hero
   * panel at the panel rung's 20px on the same page.
   */
  it("rounds the dates panel at the panel rung", () => {
    const { container } = render(<CourseSessions sessions={[]} {...props} />);

    const panel = container.querySelector("#dates > div");
    expect(panel?.className).toMatch(/\brounded-panel\b/);
    expect(panel?.className).not.toMatch(/\brounded-3xl\b/);
  });
});

/**
 * The course page's phone foot bar (UX audit #8): the same persistent door the
 * trip page keeps, pointing where the dates panel's own primary act does.
 */
describe("courseFootBar", () => {
  const t = diverTranslator("en-US");
  const open = { capacity: 8, booked: 3 };
  const full = { capacity: 8, booked: 8 };

  it("books when any date has room, even when the soonest is full", () => {
    expect(courseFootBar([full, open], "#get-in-touch", t)).toEqual({
      href: "#dates",
      label: "Book",
    });
  });

  it("offers the wait list when every date is full", () => {
    expect(courseFootBar([full], null, t)).toEqual({
      href: "#dates",
      label: "Join the wait list",
    });
  });

  it("asks for a date when none is on the board, and keeps no door without an address", () => {
    expect(courseFootBar([], "#get-in-touch", t)).toEqual({
      href: "#get-in-touch",
      label: "Request a date",
    });
    expect(courseFootBar([], null, t)).toBeNull();
  });
});
