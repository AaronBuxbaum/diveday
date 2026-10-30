// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictGuardedForm } from "./ConflictGuardedForm";

afterEach(cleanup);

describe("ConflictGuardedForm", () => {
  it("restores the submitted repeated and disabled controls after a conflict", async () => {
    const action = vi.fn(async () => ({ ok: false as const, reason: "conflict" as const }));
    render(
      <ConflictGuardedForm
        action={action}
        conflictMessage="This course changed elsewhere."
        reloadLabel="Reload"
      >
        <label htmlFor="faq-question">FAQ question</label>
        <input id="faq-question" name="faq" defaultValue="Saved question" />
        <label htmlFor="faq-answer">FAQ answer</label>
        <input id="faq-answer" name="faq" defaultValue="Saved answer" />
        <label htmlFor="required-form">Required form</label>
        <input id="required-form" type="checkbox" name="required" value="yes" />
        <label htmlFor="course-days-one">One day</label>
        <input id="course-days-one" type="radio" name="courseDays" value="one" />
        <label htmlFor="course-days-two">Two days</label>
        <input id="course-days-two" type="radio" name="courseDays" value="two" defaultChecked />
        <label htmlFor="disabled-note">Disabled note</label>
        <input id="disabled-note" name="note" defaultValue="Saved note" disabled />
        <input aria-label="Course photo" type="file" name="photo" />
      </ConflictGuardedForm>,
    );

    fireEvent.input(screen.getByLabelText("FAQ question"), {
      target: { value: "Typed question" },
    });
    fireEvent.input(screen.getByLabelText("FAQ answer"), {
      target: { value: "Typed answer" },
    });
    fireEvent.click(screen.getByLabelText("Required form"));
    fireEvent.click(screen.getByLabelText("One day"));
    const disabledNote = screen.getByLabelText("Disabled note") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      disabledNote,
      "Typed disabled note",
    );

    const form = screen.getByLabelText("FAQ question").closest("form");
    if (!form) throw new Error("Missing guarded form");
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("This course changed elsewhere."),
    );
    expect((screen.getByLabelText("FAQ question") as HTMLInputElement).value).toBe(
      "Typed question",
    );
    expect((screen.getByLabelText("FAQ answer") as HTMLInputElement).value).toBe("Typed answer");
    expect((screen.getByLabelText("Required form") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("One day") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Two days") as HTMLInputElement).checked).toBe(false);
    expect(disabledNote.value).toBe("Typed disabled note");
    expect((screen.getByLabelText("Course photo") as HTMLInputElement).value).toBe("");
    expect(action).toHaveBeenCalledTimes(1);
  });
});
