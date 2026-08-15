// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { NO_CERTIFICATION_ANSWER } from "@/lib/dive-declaration";
import { DiveDeclarationFields } from "./DiveDeclarationFields";

afterEach(cleanup);

/**
 * **The one question a stranger is asked about their own diving**, on both
 * public opt-in forms (ADR 20260814-self-declared-cards).
 *
 * The interesting behaviour is the contradiction it refuses to collect: a
 * joiner who says they hold no card and also ticks "I'm certified for nitrox"
 * has said two incompatible things, and the writer resolves that by recording
 * the absence. The form has to show that it did, or the diver leaves believing
 * they told the shop about an enriched-air card — the same broken promise as
 * asking a question and discarding the answer.
 */
function renderFields() {
  return render(
    // The same two namespaces the public forms mount it under: `common` for the
    // question, `course` for the level words it shares with the course pages.
    <DiverIntlProvider locale="en-US" timeZone="America/New_York" namespaces={["common", "course"]}>
      <DiveDeclarationFields />
    </DiverIntlProvider>,
  );
}

describe("DiveDeclarationFields", () => {
  it("offers 'not certified yet' above the ladder, and skipping above both", () => {
    renderFields();

    const options = [...screen.getAllByRole("option")].map((option) =>
      option.getAttribute("value"),
    );
    // Skipping stays the default; then no card; then the five rungs in order,
    // so the whole select reads in one direction.
    expect(options.slice(0, 3)).toEqual(["", NO_CERTIFICATION_ANSWER, "open_water"]);
    expect(options).toHaveLength(7);
  });

  it("clears and disables the nitrox tick when the diver says they hold no card", async () => {
    const user = userEvent.setup();
    renderFields();
    const nitrox = screen.getByRole("checkbox");
    await user.click(nitrox);
    expect(nitrox).toBeChecked();

    await user.selectOptions(screen.getByRole("combobox"), NO_CERTIFICATION_ANSWER);

    // Disabled rather than hidden — the question stays where it was, and a
    // disabled control posts nothing, which is exactly what the writer would
    // have done with the tick anyway.
    expect(nitrox).toBeDisabled();
    expect(nitrox).not.toBeChecked();
  });

  it("gives the tick back when the diver names a level instead", async () => {
    const user = userEvent.setup();
    renderFields();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, NO_CERTIFICATION_ANSWER);
    await user.selectOptions(select, "rescue");

    const nitrox = screen.getByRole("checkbox");
    expect(nitrox).toBeEnabled();
    // Not silently re-ticked: an unticked box is silence, and a box that ticks
    // itself back on would be the app claiming something nobody said.
    expect(nitrox).not.toBeChecked();
  });
});
