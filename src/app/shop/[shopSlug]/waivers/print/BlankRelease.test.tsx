// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RSTC_QUESTIONNAIRE } from "@/lib/medical";
import type { ShopQuestion } from "@/lib/waiver-questions";
import { BlankRelease, type BlankReleaseCopy } from "./BlankRelease";

afterEach(cleanup);

const COPY: BlankReleaseCopy = {
  version: "Release version {version}",
  medicalHeading: "Medical questionnaire",
  yes: "Yes",
  no: "No",
  followUp: "Answer if you said yes to question {number}.",
  shopHeading: "Questions from Blue Mantis",
  signatureHeading: "Signatures",
  printedName: "Printed name",
  diverSignature: "Diver signature",
  guardianName: "Guardian name",
  guardianSignature: "Guardian signature",
  guardianNote: "Minors: a guardian signs too.",
  date: "Date",
};

const QUESTIONS: ShopQuestion[] = [
  { id: "a", kind: "yes_no", prompt: "Do you carry dive insurance?", required: false },
  { id: "b", kind: "text", prompt: "How did you hear about us?", required: false },
  { id: "c", kind: "choice", prompt: "Shirt size?", required: false, options: ["S", "M", "L"] },
];

function renderBlank(shopQuestions: ShopQuestion[] = QUESTIONS) {
  return render(
    <BlankRelease
      version={7}
      body={"I accept the risks.\nSecond paragraph."}
      questionnaire={RSTC_QUESTIONNAIRE}
      shopQuestions={shopQuestions}
      copy={COPY}
    />,
  );
}

describe("the blank release", () => {
  it("prints the version and the release text as published", () => {
    const { container } = renderBlank();
    expect(screen.getByText("Release version 7")).toBeTruthy();
    expect(container.textContent).toContain("I accept the risks.\nSecond paragraph.");
  });

  it("gives every standard question empty yes and no boxes, never ticked", () => {
    const { container } = renderBlank();
    const primaries = RSTC_QUESTIONNAIRE.questions.filter((q) => q.section === "primary");
    expect(primaries).toHaveLength(10);
    for (const question of RSTC_QUESTIONNAIRE.questions) {
      expect(screen.getByText(question.prompt, { exact: false })).toBeTruthy();
    }
    // One Yes and one No for every question, shop's yes/no question included.
    const total = RSTC_QUESTIONNAIRE.questions.length + 1;
    expect(screen.getAllByText("Yes")).toHaveLength(total);
    expect(screen.getAllByText("No")).toHaveLength(total);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("[checked], [aria-checked='true']")).toBeNull();
  });

  it("names the question each box follows", () => {
    renderBlank();
    expect(screen.getByText("Answer if you said yes to question 1.")).toBeTruthy();
    expect(screen.getByText("Answer if you said yes to question 2.")).toBeTruthy();
  });

  it("prints the shop's questions with their blanks and options", () => {
    renderBlank();
    expect(screen.getByText("Questions from Blue Mantis")).toBeTruthy();
    const section = screen.getByText("Questions from Blue Mantis").closest("section");
    if (!section) throw new Error("no shop questions section");
    expect(within(section).getByText("How did you hear about us?", { exact: false })).toBeTruthy();
    for (const option of ["S", "M", "L"]) expect(within(section).getByText(option)).toBeTruthy();
  });

  it("leaves the shop's section out when it asks nothing", () => {
    renderBlank([]);
    expect(screen.queryByText("Questions from Blue Mantis")).toBeNull();
  });

  it("ends on the diver and guardian signature lines", () => {
    renderBlank();
    for (const line of ["Diver signature", "Guardian signature", "Printed name", "Guardian name"]) {
      expect(screen.getByText(line)).toBeTruthy();
    }
    expect(screen.getAllByText("Date")).toHaveLength(2);
  });
});
