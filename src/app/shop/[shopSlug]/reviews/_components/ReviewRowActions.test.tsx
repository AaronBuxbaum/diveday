// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewActionResult } from "../actions";
import {
  ReviewRowActions,
  type ReviewRowCopy,
  ReviewRowProvider,
  ReviewRowUndoToast,
} from "./ReviewRowActions";

/**
 * The real action is a server action; what this file is about is which
 * component holds its result, so the action itself is a stub that answers with
 * the review it was posted for.
 */
vi.mock("../actions", () => ({
  reviewRowAction: async (_previous: ReviewActionResult, formData: FormData) => {
    const reviewId = String(formData.get("reviewId") ?? "");
    return formData.get("publish") === "true"
      ? { ok: true as const, reviewId, effect: "published" as const }
      : { ok: true as const, reviewId, effect: "hidden" as const, undoReviewId: reviewId };
  },
}));

afterEach(cleanup);

const A = "aaaaaaaa-1111-4222-8333-444444444444";
const B = "bbbbbbbb-1111-4222-8333-444444444444";

const copy: ReviewRowCopy = {
  publish: "Publish",
  republish: "Republish",
  saving: "Saving",
  hide: "Hide",
  hideConfirm: "Hide it",
  hideReasonLabel: "Reason",
  hideReasonPlaceholder: "In your words",
  hideNoteLabel: "Note",
  markStandout: "Feature",
  removeStandout: "Unfeature",
  hiddenToast: "Hidden.",
  undo: "Undo",
  undoPending: "Undoing",
  published: "Published.",
  standout: "Featured.",
  standoutRemoved: "No longer featured.",
  reasonRequired: "Pick a reason.",
  noteRequired: "Say why.",
  noteTooLong: "Too long.",
  error: "That could not be updated.",
};

function bar(reviewId: string, isPublished: boolean) {
  return (
    <ReviewRowActions
      reviewId={reviewId}
      isPublished={isPublished}
      isHidden={false}
      isStandout={false}
      canStandout={false}
      reasons={[{ value: "spam", label: "Spam or a test" }]}
      copy={copy}
    />
  );
}

/** The page's shape: three independent lists a review moves between. */
function page({ waiting, published }: { waiting: string[]; published: string[] }) {
  return (
    <ReviewRowProvider>
      <ReviewRowUndoToast copy={copy} />
      <ul>
        {waiting.map((id) => (
          <li key={id}>{bar(id, false)}</li>
        ))}
      </ul>
      <ul>
        {published.map((id) => (
          <li key={id}>{bar(id, true)}</li>
        ))}
      </ul>
    </ReviewRowProvider>
  );
}

/**
 * **The outcome has to survive the move it is reporting.**
 *
 * This page renders waiting, published and hidden as three separate `<ul>`s,
 * and every control in a row's bar exists to move that row from one of them to
 * another. React does not reparent across lists — it unmounts the `<li>` from
 * the list it left and mounts a new one in the list it joined — so a
 * `useActionState` living inside the row was destroyed by the very act it
 * existed to report. Publishing said nothing; a hide lost its Undo.
 *
 * The state lives above the lists now, which is why the second half of each
 * case matters: with one state serving every row, a row that does not check
 * `result.reviewId` would report its neighbour's outcome as its own.
 */
describe("the review row's outcome", () => {
  it("is still on screen after publishing moves the row to another list", async () => {
    const { rerender } = render(page({ waiting: [A], published: [] }));
    await userEvent.click(screen.getByRole("button", { name: copy.publish }));
    expect(await screen.findByText(copy.published)).toBeInTheDocument();

    // What the revalidation paints: the same review, now in the published list.
    rerender(page({ waiting: [], published: [A] }));
    expect(screen.getByText(copy.published)).toBeInTheDocument();
  });

  it("belongs to the row that was tapped, never to its neighbours", async () => {
    render(page({ waiting: [A, B], published: [] }));
    const buttons = screen.getAllByRole("button", { name: copy.publish });
    expect(buttons).toHaveLength(2);
    if (!buttons[1]) throw new Error("the second waiting row rendered no Publish");
    await userEvent.click(buttons[1]);

    expect(await screen.findAllByText(copy.published)).toHaveLength(1);
  });
});

/**
 * A hide takes its own row off the group, and off the *page* entirely once a
 * shop has more moderated reviews than fit one — so the toast that offers Undo
 * cannot live in the row. Hoisting the state was not enough on its own.
 */
describe("the hide's undo toast", () => {
  it("renders above the lists, where the hidden row no longer is", async () => {
    const { rerender } = render(page({ waiting: [], published: [A] }));
    // The reason picker waits behind a disclosure; the act is the button inside
    // it (ADR 20260813-review-moderation-has-a-floor).
    await userEvent.click(screen.getByText(copy.hide));
    await userEvent.selectOptions(screen.getByLabelText(copy.hideReasonLabel), "spam");
    await userEvent.click(screen.getByRole("button", { name: copy.hideConfirm }));

    // The revalidated page: this shop's moderated list is longer than one page,
    // so the review it just hid is not on the page at all any more.
    rerender(page({ waiting: [], published: [] }));
    expect(screen.getByText(copy.hiddenToast)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.undo })).toBeInTheDocument();
  });
});
