// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ledgerKindColumnClass } from "@/components/ui/ledger";
import { staffTranslator } from "@/i18n/staff-messages";
import { RecapNoteEditor } from "./RecapNoteEditor";

afterEach(cleanup);

const t = staffTranslator("en-US");

/**
 * The e2e fleet reaches this component only through `seed-evening`, which
 * moves a day's departures behind the frozen `DIVEDAY_CLOCK` (one
 * process-wide instant at 09:30 shop-local, so nothing seeded is `ended`
 * otherwise). These are the assertions that would need a browser to hold
 * otherwise.
 */
describe("the settled station's post-trip recap note", () => {
  it("states the note it already holds at rest, so a closed row still answers 'is there one?'", () => {
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout="Eagle ray on the second dive!"
        saved={false}
        t={t}
      />,
    );
    // Twice: once as the summary's quiet line, once as the textarea's value.
    expect(screen.getAllByText("Eagle ray on the second dive!")).not.toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "Post-trip recap note" })).toHaveValue(
      "Eagle ray on the second dive!",
    );
  });

  it("says so plainly when there is no note, rather than showing an empty line", () => {
    render(<RecapNoteEditor action={vi.fn()} shoutout={null} saved={false} t={t} />);
    expect(screen.getByText("No note yet. Recaps go out without one.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Post-trip recap note" })).toHaveValue("");
  });

  it("stays closed until it is opened — the departures list is a reconciliation, not a form", () => {
    const { container } = render(
      <RecapNoteEditor action={vi.fn()} shoutout={null} saved={false} t={t} />,
    );
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("re-opens with its confirmation after a save, so the outcome is never hidden behind a caret", () => {
    // The same rule the trip About panel's rows carry: a form whose result lands inside
    // a closed disclosure is a form the staffer cannot see worked.
    const { container } = render(
      <RecapNoteEditor action={vi.fn()} shoutout="Thanks for diving with us." saved t={t} />,
    );
    expect(container.querySelector("details")?.open).toBe(true);
    expect(
      screen.getByText(/Recap note saved\. It rides along on every diver’s recap\./),
    ).toBeInTheDocument();
  });

  it("renders the recap send controls under the post-trip disclosure", () => {
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout={null}
        saved={false}
        t={t}
        tripId="trip-123"
        recapSendAction={vi.fn()}
        toggleRecapAutoSendPauseAction={vi.fn()}
        recapAutoSendAt={new Date("2026-08-16T16:00:00.000Z")}
        recapAutoSendPaused={false}
        recapNowMs={new Date("2026-08-16T12:00:00.000Z").getTime()}
      />,
    );
    expect(screen.getByText("Recap")).toBeInTheDocument();
    expect(screen.getByText(/Automatic recap sending begins in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause automatic sending" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeInTheDocument();
  });

  it("says the recap is waiting to send exactly once, open or closed", () => {
    // The station always passes `recapStatusSummary` — the same
    // status text the summary row and "Recap sending"'s own line would
    // otherwise both say. Closed, only the summary row's line is visible;
    // open, "Recap sending" (with the live countdown and Send/Pause) is the
    // one place saying it — the plain paragraph in between is gone.
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout={null}
        saved
        t={t}
        tripId="trip-123"
        recapSendAction={vi.fn()}
        toggleRecapAutoSendPauseAction={vi.fn()}
        recapAutoSendAt={new Date("2026-08-16T16:00:00.000Z")}
        recapAutoSendPaused={false}
        recapNowMs={new Date("2026-08-16T12:00:00.000Z").getTime()}
        recapStatusSummary="This recap will go out automatically in about 1 hour."
      />,
    );
    expect(
      screen.getAllByText("This recap will go out automatically in about 1 hour."),
    ).toHaveLength(1);
  });

  it("locks the note and photo controls after the recap is sent", () => {
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout="Thanks for diving with us."
        saved={false}
        t={t}
        recapSentAt={new Date("2026-08-16T16:00:00.000Z")}
        recapSentAtLabel="4:00 PM"
        photos={[
          {
            id: "photo-1",
            imageUrl: "https://img.example/photo.jpg",
            caption: null,
            diverName: "Rae R.",
            bookingId: "booking-1",
          },
        ]}
        deletePhotoAction={vi.fn()}
        uploadCrewPhotoAction={vi.fn()}
        deleteCrewPhotoAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Post-trip recap note" })).toBeDisabled();
    expect(
      screen.getAllByText("This recap was sent at 4:00 PM. The note and photos are now locked.")[0],
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a photo")).not.toBeInTheDocument();
  });

  it("adds a crew photo with one control, drawn as the gallery's next cell", () => {
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout={null}
        saved={false}
        t={t}
        crewPhotos={[{ id: "crew-1", imageUrl: "https://img.example/crew.jpg" }]}
        uploadCrewPhotoAction={vi.fn()}
        deleteCrewPhotoAction={vi.fn()}
      />,
    );
    const picker = screen.getByLabelText("Add a photo");
    expect(picker).toHaveAttribute("type", "file");
    // No second step: picking the photo is what sends it.
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a photo" })).not.toBeInTheDocument();
    // The tile sits in the same list as the photo it will join.
    const gallery = screen
      .getByRole("img", { name: "Crew photo from this departure" })
      .closest("ul");
    expect(gallery).toContainElement(picker);
  });
});

describe("the recap row at rest", () => {
  const WAITING = "This recap will go out automatically in about 3 hours.";

  function renderClosed() {
    return render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout={null}
        saved={false}
        t={t}
        recapStatusSummary={WAITING}
      />,
    );
  }

  /**
   * **The sentence keeps the words that are its meaning** (pixel-craft class 8,
   * K-150). One truncated line was sized for a staff-written note, and the
   * same span carries the status sentence, whose last words are when it goes:
   * at 390 it ran 360px in a 316px box and lost "3 hours." to the ellipsis.
   *
   * Two lines until `md`, not `sm`. From `sm` the note sits beside the
   * kind's 104px column (K-260), about W − 242px wide in the card, and the
   * es-ES sentence ("…se enviará automáticamente en aproximadamente 45
   * minutos.") runs about 450px: one line holds it only from about 700px, so a
   * phone on its side lost the time again. From `md` (526px and up) one line
   * is wide enough.
   */
  it("gives the status sentence two lines until one holds it, rather than lose its time", () => {
    renderClosed();
    const note = screen.getByText(WAITING);
    expect(note.closest("summary")).not.toBeNull();
    expect(note).toHaveClass("max-md:line-clamp-2", "md:truncate");
    expect(note.className).not.toMatch(/(?:^|\s)(?:sm:)?truncate(?:\s|$)/);
    expect(note).not.toHaveClass("max-sm:line-clamp-2");
  });

  /**
   * **One row anatomy under the settled station's rule** (pixel-craft class 3,
   * K-260). The unsold-seats row above is a `LedgerRow` with a kind: its word in
   * the kind's column, its sentence a `gap-3` after it. The recap led with its
   * caret and set its note `gap-2` after the word, so "Recap" started 20px right
   * of "Unsold seats" and its note 35px left of that row's sentence. The word
   * takes the kind's column, the note the row's gap, and the caret goes to the
   * row's end, where a door's glyph is.
   */
  it("lays its word and note on the ledger's kind column and sentence edge", () => {
    const { container } = renderClosed();
    const summary = container.querySelector("summary");
    const [label, note] = [...(summary?.children ?? [])];
    expect(label).toHaveTextContent("Recap");
    expect(label).toHaveClass(ledgerKindColumnClass, "shrink-0");
    expect(note).toHaveTextContent(WAITING);
    expect(summary).toHaveClass("gap-x-3");
    expect(summary?.className).not.toMatch(/(?:^|\s)(?:sm:)?gap-2(?:\s|$)/);
    // The caret is last, so nothing stands before the word; and with it gone
    // from the start, the stacked note has no caret to clear.
    expect(summary?.lastElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(summary?.lastElementChild).toHaveClass("ms-auto");
    expect(note.className).not.toMatch(/(?:^|\s)ps-/);
  });

  /**
   * **The card's last line sits as far from its foot as its first from its
   * top** (pixel-craft class 5, K-453). From `sm` the summary is one 20px line
   * in a 44px target, the card's last thing, so 12px of invisible target sat
   * between the Recap line and the card's 24px padding: 38px of card under
   * the last ink against 28px over the first. Closed, the target keeps its
   * 44px and overhangs the padding by the excess (`sm:-mb-3`); open, the form
   * follows it and the margin goes. Below `sm` the stacked word and note fill
   * the target already.
   *
   * The excess is padding (`sm:py-3`), not the room left round a centred
   * line: between `sm` and `md` the note may take two lines (K-150), and a
   * 40px note centred in 44 would have hung 10px of text into the card's
   * padding. Padded, the note's last line always ends where the margin does.
   */
  it("lets its target overhang the card's foot at rest, and only at rest", () => {
    const { container } = renderClosed();
    const summary = container.querySelector("summary");
    expect(summary).toHaveClass("min-h-11", "sm:py-3", "sm:-mb-3", "sm:group-open/recap:mb-0");
    expect(summary?.className).not.toMatch(/(?:^|\s)-mb-/);
  });
});
