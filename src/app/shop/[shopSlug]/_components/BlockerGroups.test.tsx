// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockerQueue } from "@/db/blockers";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { annotateAlsoOn, type BlockerQueueTrip } from "@/lib/blockers";
import { BLOCKERS_TRIPS_PER_PAGE } from "@/lib/operational-window";
import { BlockerGroups } from "./BlockerGroups";

// BlockerGroups composes WaiverSendControl, which imports the `"use server"`
// action module. Same treatment as TodayQueue.test.tsx.
vi.mock("@/app/actions/waivers", () => ({ sendWaiversAction: vi.fn() }));

/**
 * The shop home's **by-departure** view of the work queue (ADR
 * 20260803-not-ready-is-a-view).
 *
 * Worth direct tests rather than only e2e because almost everything it decides
 * is a *count* or a *branch*, and a wrong count here is silently plausible:
 * "3 divers blocked" reads fine whether or not 3 is the number of people. The
 * two that matter most are the headline badge — distinct **people**, not rows,
 * so a diver booked on two boats is one problem to fix — and the batch send,
 * which must appear only where it would send more than one waiver.
 *
 * The real `staffTranslator` is used throughout (repo convention, see
 * Pager.test.tsx): a missing message key fails here rather than rendering a
 * raw key on the page.
 */

afterEach(() => {
  cleanup();
});

const t = staffTranslator("en-US");
const TZ = "America/New_York";
const LOCALE = "en-US";
const HEADING_ID = "today-queue-heading";

let seq = 0;

function diver(
  overrides: Partial<BlockerQueueTrip["divers"][number]> & { fullName: string },
): BlockerQueueTrip["divers"][number] {
  seq += 1;
  const bookingId = overrides.bookingId ?? `booking-${seq}`;
  const personId = overrides.personId ?? `person-${seq}`;
  return {
    bookingId,
    personId,
    fullName: overrides.fullName,
    blockers: overrides.blockers ?? [{ code: "waiver_not_sent" }],
    alsoOn: overrides.alsoOn ?? [],
    fix: overrides.fix ?? {
      label: "Send waiver",
      href: `/shop/blue-mantis/divers/${personId}`,
      sendsWaiver: true,
      bookingId,
    },
  };
}

function trip(overrides: Partial<BlockerQueueTrip> & { tripId: string }): BlockerQueueTrip {
  return {
    tripId: overrides.tripId,
    title: overrides.title ?? `Departure ${overrides.tripId}`,
    startsAt: overrides.startsAt ?? new Date("2026-08-07T13:30:00Z"),
    courseTitle: overrides.courseTitle ?? null,
    booked: overrides.booked ?? 6,
    ready: overrides.ready ?? 4,
    divers: overrides.divers ?? [diver({ fullName: "Priya Raman" })],
    // Every existing test below builds trips directly rather than through
    // `getBlockerQueue`, so they never disagree with real urgency math — one
    // shared band means grouping never folds anything, which is exactly the
    // pre-existing, flat-list behavior those tests assert. The fold itself
    // gets its own describe block, with trips that set this explicitly.
    urgency: overrides.urgency ?? "now",
  };
}

function queue(trips: BlockerQueueTrip[], truncated = false): BlockerQueue {
  return { trips, truncated };
}

function renderGroups(q: BlockerQueue, requestedPage = 1) {
  return render(
    <BlockerGroups
      queue={q}
      requestedPage={requestedPage}
      shopSlug="blue-mantis"
      timeZone={TZ}
      locale={LOCALE}
      pageHref={(page) => `/shop/blue-mantis?view=departures&page=${page}`}
      headingId={HEADING_ID}
      t={t}
    />,
  );
}

/** The one departure card whose heading links to this trip. */
function tripCard(title: string) {
  const link = screen.getByRole("link", { name: title });
  const section = link.closest("section");
  if (!section) throw new Error(`no card around ${title}`);
  return within(section);
}

describe("the headline count is people, not rows", () => {
  it("counts one diver booked on two departures as a single blocked person", () => {
    // The whole reason `distinctBlockedDivers` exists. Two rows, one human —
    // and "2 divers can't board" would send staff looking for a second person
    // who does not exist.
    const trips = annotateAlsoOn([
      trip({
        tripId: "trip-1",
        title: "Morning Reef",
        divers: [diver({ fullName: "Priya Raman", personId: "person-shared" })],
      }),
      trip({
        tripId: "trip-2",
        title: "Afternoon Wall",
        divers: [diver({ fullName: "Priya Raman", personId: "person-shared" })],
      }),
    ]);

    renderGroups(queue(trips));

    expect(screen.getByText(t("blockers.blockedCount", { count: 1 }))).toBeInTheDocument();
    expect(screen.queryByText(t("blockers.blockedCount", { count: 2 }))).not.toBeInTheDocument();
  });

  it("counts distinct people across departures when they really are different", () => {
    const trips = [
      trip({ tripId: "trip-1", divers: [diver({ fullName: "Priya Raman" })] }),
      trip({
        tripId: "trip-2",
        divers: [diver({ fullName: "Tomas Ek" }), diver({ fullName: "Nia Okonjo" })],
      }),
    ];
    renderGroups(queue(trips));
    expect(screen.getByText(t("blockers.blockedCount", { count: 3 }))).toBeInTheDocument();
  });

  it("shows no badge at all when nothing is blocked", () => {
    // A zero badge is noise; the empty state carries the all-clear instead.
    renderGroups(queue([]));
    expect(screen.getByText(t("blockers.emptyTitle"))).toBeInTheDocument();
    expect(screen.queryByText(t("blockers.blockedCount", { count: 0 }))).not.toBeInTheDocument();
  });
});

describe("the same person across two boats", () => {
  it("names the other departure on each row so staff fix one human once", () => {
    const trips = annotateAlsoOn([
      trip({
        tripId: "trip-1",
        title: "Morning Reef",
        divers: [diver({ fullName: "Priya Raman", personId: "person-shared" })],
      }),
      trip({
        tripId: "trip-2",
        title: "Afternoon Wall",
        divers: [diver({ fullName: "Priya Raman", personId: "person-shared" })],
      }),
    ]);

    renderGroups(queue(trips));

    // Each card points at the *other* departure, never at itself.
    expect(
      tripCard("Morning Reef").getByText(t("blockers.alsoBlockedOn", { trips: "Afternoon Wall" })),
    ).toBeInTheDocument();
    expect(
      tripCard("Afternoon Wall").getByText(t("blockers.alsoBlockedOn", { trips: "Morning Reef" })),
    ).toBeInTheDocument();
  });

  it("says nothing about other departures for a diver blocked on one", () => {
    renderGroups(queue(annotateAlsoOn([trip({ tripId: "trip-1", title: "Morning Reef" })])));
    expect(screen.queryByText(/also blocked/i)).not.toBeInTheDocument();
  });
});

describe("the batch waiver send", () => {
  it("offers one send-all per departure once two waivers would go out", () => {
    renderGroups(
      queue([
        trip({
          tripId: "trip-1",
          title: "Morning Reef",
          divers: [diver({ fullName: "Priya Raman" }), diver({ fullName: "Tomas Ek" })],
        }),
      ]),
    );

    expect(
      screen.getByRole("button", { name: t("blockers.sendAllWaivers", { count: 2 }) }),
    ).toBeInTheDocument();
  });

  it("does not offer a batch for a single waiver — the row's own button is the send", () => {
    // A "send all 1" is a second button that does exactly what the row already
    // does, and doubles the ways to fire the same email.
    renderGroups(queue([trip({ tripId: "trip-1", divers: [diver({ fullName: "Priya Raman" })] })]));
    expect(
      screen.queryByRole("button", { name: t("blockers.sendAllWaivers", { count: 1 }) }),
    ).not.toBeInTheDocument();
  });

  it("counts only the rows a waiver send would actually clear", () => {
    // Three blocked divers, but one is blocked on a certification — sending
    // waivers cannot fix them, so the batch is 2 and must not claim 3.
    renderGroups(
      queue([
        trip({
          tripId: "trip-1",
          divers: [
            diver({ fullName: "Priya Raman" }),
            diver({ fullName: "Tomas Ek" }),
            diver({
              fullName: "Nia Okonjo",
              blockers: [{ code: "certification_missing" }],
              fix: {
                label: "Open Nia's record",
                href: "/shop/blue-mantis/divers/person-nia",
                sendsWaiver: false,
                bookingId: "booking-nia",
              },
            }),
          ],
        }),
      ]),
    );

    expect(
      screen.getByRole("button", { name: t("blockers.sendAllWaivers", { count: 2 }) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("blockers.sendAllWaivers", { count: 3 }) }),
    ).not.toBeInTheDocument();
  });

  it("gives a non-waiver row a link to the surface that fixes it, not a send button", () => {
    renderGroups(
      queue([
        trip({
          tripId: "trip-1",
          divers: [
            diver({
              fullName: "Nia Okonjo",
              blockers: [{ code: "certification_missing" }],
              fix: {
                label: "Open Nia's record",
                href: "/shop/blue-mantis/divers/person-nia",
                sendsWaiver: false,
                bookingId: "booking-nia",
              },
            }),
          ],
        }),
      ]),
    );

    const fix = screen.getByRole("link", { name: "Open Nia's record" });
    expect(fix).toHaveAttribute("href", "/shop/blue-mantis/divers/person-nia");
  });
});

describe("what a blocked row says", () => {
  it("spells every blocker through the shared readiness words", () => {
    // Never an inline status string — `readinessBlockerText` is the one place
    // these are worded, so a row with two blockers lists both, in those words.
    renderGroups(
      queue([
        trip({
          tripId: "trip-1",
          divers: [
            diver({
              fullName: "Priya Raman",
              blockers: [{ code: "waiver_pending" }, { code: "medical_review" }],
            }),
          ],
        }),
      ]),
    );

    // Asserted through `readinessBlockerText` itself, not a key spelled here:
    // the contract is "this surface uses the shared words", and hard-coding the
    // English would pass even if the row stopped calling it.
    expect(
      screen.getByText(readinessBlockerText(t, { code: "waiver_pending" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(readinessBlockerText(t, { code: "medical_review" })),
    ).toBeInTheDocument();
  });

  it("links the diver's name to their record", () => {
    renderGroups(
      queue([
        trip({
          tripId: "trip-1",
          divers: [diver({ fullName: "Priya Raman", personId: "person-priya" })],
        }),
      ]),
    );
    expect(screen.getByRole("link", { name: "Priya Raman" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-priya",
    );
  });

  it("states blocked-of-booked per departure", () => {
    renderGroups(
      queue([
        trip({
          tripId: "trip-1",
          title: "Morning Reef",
          booked: 8,
          divers: [diver({ fullName: "Priya Raman" }), diver({ fullName: "Tomas Ek" })],
        }),
      ]),
    );
    expect(
      tripCard("Morning Reef").getByText(t("blockers.tripBlockedCount", { blocked: 2, booked: 8 })),
    ).toBeInTheDocument();
  });

  it("shows a course session's title beside the departure", () => {
    renderGroups(
      queue([trip({ tripId: "trip-1", title: "Morning Reef", courseTitle: "Open Water Day 2" })]),
    );
    expect(tripCard("Morning Reef").getByText(/Open Water Day 2/)).toBeInTheDocument();
  });
});

describe("pagination", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      trip({ tripId: `trip-${index}`, title: `Departure ${index}` }),
    );

  it("shows only one page of departures and keeps the rest a page away", () => {
    // A blocker list must never truncate silently — the tail is paged, not
    // dropped. 26 departures once rendered as one ~10,700px scroll.
    const trips = many(BLOCKERS_TRIPS_PER_PAGE + 3);
    renderGroups(queue(trips));

    expect(screen.getByRole("link", { name: "Departure 0" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: `Departure ${BLOCKERS_TRIPS_PER_PAGE}` }),
    ).not.toBeInTheDocument();
    // Scoped to the pager itself: the section description also names the
    // departure count, and the pager renders "Page 1 of 2 · 13 departures" as a
    // single node.
    const pager = within(screen.getByRole("navigation", { name: t("shared.pager.label") }));
    expect(
      pager.getByText(t("blockers.pagination.total", { count: trips.length }), { exact: false }),
    ).toBeInTheDocument();
    expect(
      pager.getByText(t("shared.pager.position", { page: 1, pageCount: 2 }), { exact: false }),
    ).toBeInTheDocument();
  });

  it("renders the requested page's departures, not the first page's", () => {
    const trips = many(BLOCKERS_TRIPS_PER_PAGE + 3);
    renderGroups(queue(trips), 2);

    expect(
      screen.getByRole("link", { name: `Departure ${BLOCKERS_TRIPS_PER_PAGE}` }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Departure 0" })).not.toBeInTheDocument();
  });

  it("clamps a page past the end rather than rendering an empty queue", () => {
    // `?page=99` is one mistyped URL away, and an empty list would read as
    // "nothing is blocked" — the most dangerous wrong answer this view can give.
    const trips = many(BLOCKERS_TRIPS_PER_PAGE + 3);
    renderGroups(queue(trips), 99);
    expect(
      screen.getByRole("link", { name: `Departure ${BLOCKERS_TRIPS_PER_PAGE}` }),
    ).toBeInTheDocument();
  });

  it("counts every blocked person, not just the ones on the visible page", () => {
    // The badge describes the queue; the page describes the scroll.
    const trips = many(BLOCKERS_TRIPS_PER_PAGE + 3);
    renderGroups(queue(trips));
    expect(
      screen.getByText(t("blockers.blockedCount", { count: trips.length })),
    ).toBeInTheDocument();
  });
});

describe("urgency grouping and horizon folding (parity with the urgency queue)", () => {
  it("groups departures under the same urgency headings the other view uses, unfolded while every band is today's boats", () => {
    const { container } = renderGroups(
      queue([
        trip({ tripId: "trip-1", title: "Morning Reef", urgency: "imminent" }),
        trip({ tripId: "trip-2", title: "Afternoon Wall", urgency: "now" }),
      ]),
    );

    expect(screen.getByText("Next 3 hours")).toBeInTheDocument();
    expect(screen.getByText("Within 24 hours")).toBeInTheDocument();
    // Neither band is folded — no <details> at all — and both departure
    // cards render in full.
    expect(container.querySelectorAll("details")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Morning Reef" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Afternoon Wall" })).toBeInTheDocument();
  });

  it("folds 'Next 3 days' and 'This week' behind their headings once today's boats have rendered in full", () => {
    const { container } = renderGroups(
      queue([
        trip({ tripId: "trip-1", title: "Morning Reef", urgency: "now" }),
        trip({ tripId: "trip-2", title: "Later Wreck", urgency: "soon" }),
        trip({ tripId: "trip-3", title: "Next Week Course", urgency: "later" }),
      ]),
    );

    // Today's own band renders in full, outside any <details>.
    expect(screen.getByText("Within 24 hours").closest("details")).toBeNull();
    expect(screen.getByRole("link", { name: "Morning Reef" })).toBeInTheDocument();

    // The two horizon bands are folded, closed by default.
    const folds = container.querySelectorAll("details");
    expect(folds).toHaveLength(2);
    for (const fold of folds) {
      expect(fold.open).toBe(false);
    }
    expect(screen.getByText("Next 3 days").closest("details")).not.toBeNull();
    expect(screen.getByText("This week").closest("details")).not.toBeNull();
  });

  it("keeps the page's first group open even when every departure on it is a horizon band", () => {
    const { container } = renderGroups(
      queue([
        trip({ tripId: "trip-1", title: "Later Wreck", urgency: "soon" }),
        trip({ tripId: "trip-2", title: "Next Week Course", urgency: "later" }),
      ]),
    );

    // A page that opens mid-week still leads with its nearest real work.
    expect(screen.getByText("Next 3 days").closest("details")).toBeNull();
    expect(screen.getByRole("link", { name: "Later Wreck" })).toBeInTheDocument();
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(screen.getByText("This week").closest("details")).not.toBeNull();
  });

  it("keeps a folded departure reachable, never dropped — folding hides, it never drops", () => {
    renderGroups(
      queue([
        trip({ tripId: "trip-1", title: "Morning Reef", urgency: "now" }),
        trip({ tripId: "trip-2", title: "Next Week Course", urgency: "later" }),
      ]),
    );

    // In the DOM behind the fold, one native toggle away.
    expect(screen.getByText("Next Week Course")).toBeInTheDocument();
  });
});

describe("the truncation disclosure", () => {
  it("says the queue stops short of the week when the work bound was hit", () => {
    renderGroups(queue([trip({ tripId: "trip-1" })], true));
    expect(screen.getByRole("link", { name: /schedule/i })).toBeInTheDocument();
  });

  it("stays quiet when the queue really is the whole window", () => {
    renderGroups(queue([trip({ tripId: "trip-1" })], false));
    // The only schedule link in an untruncated, non-empty queue would be this
    // disclosure's.
    expect(screen.queryByRole("link", { name: /schedule/i })).not.toBeInTheDocument();
  });
});

describe("the empty state", () => {
  it("offers the schedule instead of a pager when nothing is blocked", () => {
    renderGroups(queue([]));
    expect(screen.getByText(t("blockers.emptyTitle"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("blockers.viewSchedule") })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board",
    );
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
  });

  it("labels the section by the heading both views share", () => {
    renderGroups(queue([]));
    const section = screen.getByRole("region", { name: t("blockers.title") });
    expect(section).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("blockers.title") })).toHaveAttribute(
      "id",
      HEADING_ID,
    );
  });
});
