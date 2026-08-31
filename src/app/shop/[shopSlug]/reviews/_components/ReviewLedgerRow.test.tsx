// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaffReview } from "@/db/reviews";
import { staffTranslator } from "@/i18n/staff-messages";
import { ReviewLedgerRow } from "./ReviewLedgerRow";
import type { ReviewRowCopy } from "./ReviewRowActions";
import { ReviewRowProvider } from "./ReviewRowActions";

// The row mounts the client action bar, whose only job here is to render its
// labels — the writes themselves are covered in `actions.test.ts` and against a
// real database in `src/db/reviews.test.ts`.
vi.mock("../actions", () => ({ reviewRowAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");

const REASON_KEYS = {
  abusive: "reviews.hideReason.abusive",
  names_a_person: "reviews.hideReason.namesAPerson",
  wrong_subject: "reviews.hideReason.wrongSubject",
  spam: "reviews.hideReason.spam",
  other: "reviews.hideReason.other",
} as const;

const copy: ReviewRowCopy = {
  publish: "Publish",
  republish: "Republish",
  saving: "Saving…",
  hide: "Hide",
  hideConfirm: "Hide this review",
  hideReasonLabel: "Why are you taking it down?",
  hideReasonPlaceholder: "Choose a reason…",
  hideNoteLabel: "What happened",
  markStandout: "Mark as standout",
  removeStandout: "Remove standout",
  hiddenToast: "Review hidden.",
  undo: "Undo",
  undoPending: "Putting it back…",
  published: "Review published to your schedule page.",
  standout: "Review marked as standout.",
  standoutRemoved: "Review removed from standouts.",
  reasonRequired: "Choose a reason before hiding a review.",
  noteRequired: "Say what happened.",
  noteTooLong: "That note is too long.",
  error: "That review couldn't be updated. Try again.",
};

const BASE: StaffReview = {
  id: "b2f8a5d0-1111-4222-8333-444444444444",
  rating: 5,
  comment: "Vis was unreal and the crew found us a turtle on the second tank.",
  isStandout: false,
  isPublished: false,
  isHidden: false,
  hiddenReason: null,
  hiddenReasonNote: null,
  hiddenAt: null,
  hiddenBy: null,
  diverName: "Yara Halabi",
  personId: "cccccccc-1111-4222-8333-444444444444",
  tripId: "dddddddd-1111-4222-8333-444444444444",
  tripTitle: "Two-Tank Reef — French Reef",
  divedAt: new Date("2026-08-29T11:00:00.000Z"),
  createdAt: new Date("2026-08-29T22:00:00.000Z"),
};

function row(review: Partial<StaffReview>, group: "waiting" | "published" | "hidden" = "waiting") {
  return render(
    // The row's action state lives above the three lists a review moves
    // between, so a row rendered without its provider is a row that could not
    // exist on the page (`ReviewRowProvider`).
    <ReviewRowProvider>
      <ul>
        <ReviewLedgerRow
          review={{ ...BASE, ...review }}
          group={group}
          shopSlug="blue-mantis"
          locale="en-US"
          timezone="America/Cancun"
          t={t}
          reasonKeys={REASON_KEYS}
          reasons={[{ value: "spam", label: "Spam or a test" }]}
          copy={copy}
        />
      </ul>
    </ReviewRowProvider>,
  );
}

/**
 * **The group owns the state word; the row never repeats it** (ADR
 * 20260827-people-not-lists, decision 3 — a shared fact belongs to the group
 * header). Every row used to wear a "Published" / "Hidden" / "Waiting on you"
 * pill under a heading that already said which group it was in.
 */
describe("a review row", () => {
  it("carries no state pill in any group", () => {
    for (const [group, review] of [
      ["waiting", {}],
      ["published", { isPublished: true }],
      ["hidden", { isHidden: true, hiddenReason: "spam" as const }],
    ] as const) {
      const { container } = row(review, group);
      expect(screen.queryByText("Published")).toBeNull();
      expect(screen.queryByText("Hidden")).toBeNull();
      expect(screen.queryByText("Waiting on you")).toBeNull();
      // The one pill shape in the app, and no row in a calm state wears it.
      expect(container.querySelectorAll(".rounded-full")).toHaveLength(0);
      cleanup();
    }
  });

  /** The exception a pill is *for*: the shop's own pick out of its record. */
  it("wears the one badge for a standout, and only for a published one", () => {
    row({ isPublished: true, isStandout: true }, "published");
    expect(screen.getByText("Standout")).toBeInTheDocument();
    cleanup();
    row({ isStandout: true }, "waiting");
    expect(screen.queryByText("Standout")).toBeNull();
  });

  /**
   * A contract with two callers, not decoration: Today's row and the close-out
   * both deep-link one waiting review as `/reviews#review-<id>`
   * (`src/db/today.ts`).
   */
  it("keeps the fragment Today and the close-out link to", () => {
    const { container } = row({});
    expect(container.querySelector(`#review-${BASE.id}`)).not.toBeNull();
  });

  /** Restoring words the shop took down is a republish, and says so. */
  it("offers Republish on a hidden row and Publish on a waiting one", () => {
    row({ isHidden: true, hiddenReason: "spam" }, "hidden");
    expect(screen.getByRole("button", { name: "Republish" })).toBeInTheDocument();
    // Hiding what is already hidden is not on offer.
    expect(screen.queryByText("Hide")).toBeNull();
    cleanup();
    row({});
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByText("Hide")).toBeInTheDocument();
  });

  /**
   * The case the shop recorded when it took the review down — the row's reason
   * for being in the Hidden group, so it renders whole rather than clipped.
   */
  it("states a hidden row's recorded case", () => {
    row(
      {
        isHidden: true,
        hiddenReason: "other",
        hiddenReasonNote: "not about the diving",
        hiddenAt: new Date("2026-08-31T14:00:00.000Z"),
        hiddenBy: "Dana Reyes",
      },
      "hidden",
    );
    expect(
      screen.getByText(/Hidden because: Something else — not about the diving/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Dana Reyes/)).toBeInTheDocument();
  });

  /** Full review words stay readable after moderation, including on long rows. */
  it("keeps a moderated review's complete words in a wrapping paragraph", () => {
    const comment =
      "The current was gentle, the visibility opened up, and the crew found a turtle on the second tank.";
    const { container } = row({ comment, isPublished: true }, "published");
    const reviewText = screen.getByText(comment);

    expect(reviewText).toHaveClass("break-words", "text-pretty");
    expect(reviewText).not.toHaveClass("truncate");
    expect(container.querySelector(".truncate")).toBeNull();
  });

  /** A rating with no words says so rather than rendering an empty line. */
  it("names a bare rating", () => {
    row({ comment: null, isPublished: true }, "published");
    expect(screen.getByText("Rating only.")).toBeInTheDocument();
    // Nothing to feature, so nothing offers to feature it.
    expect(screen.queryByRole("button", { name: "Mark as standout" })).toBeNull();
  });

  /** The stars are decoration; the rating is spoken (`StarRating`). */
  it("speaks the rating rather than leaving it to colour", () => {
    row({ rating: 3 });
    expect(screen.getByText("3 out of 5 stars")).toBeInTheDocument();
  });
});
