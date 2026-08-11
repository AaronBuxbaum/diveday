// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RecapNoteEditor } from "./RecapNoteEditor";

afterEach(cleanup);

const t = staffTranslator("en-US");

/**
 * The e2e fleet cannot reach this component: `DIVEDAY_CLOCK` is one
 * process-wide instant frozen at 09:30 shop-local, so every seeded departure
 * is still out when the close-out renders and nothing on that page is `ended`
 * (see the note in e2e/closeout.spec.ts). These are the assertions that would
 * otherwise live there.
 */
describe("the close-out's post-trip recap note", () => {
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
    expect(screen.getByText("No note yet — recaps go out without one.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Post-trip recap note" })).toHaveValue("");
  });

  it("stays closed until it is opened — the departures list is a reconciliation, not a form", () => {
    const { container } = render(
      <RecapNoteEditor action={vi.fn()} shoutout={null} saved={false} t={t} />,
    );
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("re-opens with its confirmation after a save, so the outcome is never hidden behind a caret", () => {
    // The same rule `EditDisclosure` records: a form whose result lands inside
    // a closed disclosure is a form the staffer cannot see worked.
    const { container } = render(
      <RecapNoteEditor action={vi.fn()} shoutout="Thanks for diving with us." saved t={t} />,
    );
    expect(container.querySelector("details")?.open).toBe(true);
    expect(
      screen.getByText(/Recap note saved — it rides along on every diver's recap\./),
    ).toBeInTheDocument();
  });
});
