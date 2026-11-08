// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CourseTeachingNoteForm } from "./CourseTeachingNoteForm";

const undo = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/undo", () => ({ undoAction: undo }));
afterEach(cleanup);

it("offers an id-based Undo for a deleted note without sending its words back", async () => {
  const action = vi.fn().mockResolvedValue({ ok: true, note: null, deletedRevision: 3 });
  render(
    <CourseTeachingNoteForm
      tripId="departure"
      shopSlug="blue-mantis"
      note="Private teaching plan"
      action={action}
      words={{
        label: "Instructor note",
        audience: "Private",
        save: "Save",
        remove: "Delete",
        busy: "Saving",
        saved: "Saved",
        deleted: "Deleted",
        undo: "Undo",
        dismiss: "Dismiss",
        errors: {
          not_found: "Unavailable",
          forbidden: "No access",
          disabled: "Disabled",
          not_a_course_session: "Not course",
          cancelled: "Cancelled",
          too_long: "Too long",
          changed: "Changed",
          invalid: "Invalid",
        },
      }}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByRole("button", { name: "Undo" })).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("");
  await userEvent.setup().click(screen.getByRole("button", { name: "Undo" }));
  const form = undo.mock.calls.at(-1)?.[1] as FormData;
  expect(Object.fromEntries(form)).toEqual({
    undo: "course-teaching-note",
    undoTrip: "departure",
    undoRevision: "3",
  });
});
