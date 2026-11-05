// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoctorAnswers, type DoctorAnswersCopy } from "./DoctorAnswers";
import { DoctorPaper, SheetAnswers } from "./DoctorPaper";
import type { DoctorAnswersState } from "./doctor-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const COPY: DoctorAnswersCopy = {
  prompt: "Enter your date of birth",
  birthdate: "Date of birth",
  submit: "Show my answers",
  submitting: "Checking",
  mismatch: "That date does not match",
  rate: "Too many tries",
  closed: "This page has closed",
  whole: "Go through the whole questionnaire",
  note: "Your doctor will ask",
};

const OPEN: DoctorAnswersState = {
  status: "open",
  items: [{ label: "Question 3", prompt: "I struggle with moderate exercise." }],
  source: "From the form you answered.",
};

function Page({ answer }: { answer: (form: FormData) => DoctorAnswersState }) {
  return (
    <DoctorPaper>
      <main>
        <DoctorAnswers action={async (_previous, form) => answer(form)} copy={COPY} />
      </main>
      <section data-testid="sheet">
        <SheetAnswers omitted="Not in this printout" whole={COPY.whole} note={COPY.note} />
      </section>
    </DoctorPaper>
  );
}

async function unlock(birthdate: string) {
  const field = screen.getByLabelText(COPY.birthdate);
  fireEvent.change(field, { target: { value: birthdate } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: COPY.submit }));
  });
}

/**
 * **The doctor's sheet prints what this tab unlocked, and only that** (issue
 * #2745; security review of layer r5-3, F1). The answers reach the sheet from
 * the unlock's own result, never from the server's markup.
 */
describe("the doctor's paper", () => {
  it("says the answers are not included until the date of birth matches", async () => {
    render(<Page answer={() => ({ status: "mismatch" })} />);
    const sheet = screen.getByTestId("sheet");
    expect(within(sheet).getByText("Not in this printout")).toBeInTheDocument();
    await unlock("1990-01-01");
    expect(screen.getByText(COPY.mismatch)).toBeInTheDocument();
    expect(within(sheet).getByText("Not in this printout")).toBeInTheDocument();
    expect(within(sheet).queryByText("Question 3")).toBeNull();
  });

  it("prints the unlocked answers once the date matches, and never the date itself", async () => {
    const seen: FormData[] = [];
    render(
      <Page
        answer={(form) => {
          seen.push(form);
          return OPEN;
        }}
      />,
    );
    await unlock("1984-03-09");
    expect(seen).toHaveLength(1);
    const sheet = screen.getByTestId("sheet");
    expect(within(sheet).getByText("Question 3")).toBeInTheDocument();
    expect(within(sheet).getByText("I struggle with moderate exercise.")).toBeInTheDocument();
    expect(within(sheet).queryByText("Not in this printout")).toBeNull();
    expect(sheet.textContent).not.toContain("1984");
    expect(sheet.querySelector("form, input, button, a")).toBeNull();
  });

  it("prints the whole questionnaire once the unlock settles on it", async () => {
    render(<Page answer={() => ({ status: "whole" })} />);
    await unlock("1990-01-01");
    expect(within(screen.getByTestId("sheet")).getByText(COPY.whole)).toBeInTheDocument();
  });

  it("forgets the answers with the render: a fresh page prints none", async () => {
    const { unmount } = render(<Page answer={() => OPEN} />);
    await unlock("1984-03-09");
    unmount();
    render(<Page answer={() => OPEN} />);
    const sheet = screen.getByTestId("sheet");
    expect(within(sheet).getByText("Not in this printout")).toBeInTheDocument();
    expect(within(sheet).queryByText("Question 3")).toBeNull();
  });

  it("prints nothing unlocked outside the page's own paper", () => {
    render(<SheetAnswers omitted="Not in this printout" whole={COPY.whole} note={COPY.note} />);
    expect(screen.getByText("Not in this printout")).toBeInTheDocument();
  });
});
