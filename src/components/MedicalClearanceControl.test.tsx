// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MedicalClearanceControl } from "@/components/MedicalClearanceControl";
import type { MedicalClearanceCopy } from "@/components/medical-clearance-copy";

/**
 * **The confirmation an earlier physician letter needs** (issue #2616): the
 * form asks for it only when the diver holds an earlier referral a letter could
 * have been written for, and names that referral's date.
 */
const COPY: MedicalClearanceCopy = {
  recordClearance: "Record the physician’s answer",
  outcomeLegend: "What did the physician say?",
  outcomeCleared: "Cleared to dive",
  outcomeNotCleared: "Not cleared",
  evaluatedOnLabel: "Date of the physician’s evaluation",
  physicianNameLabel: "Physician",
  evidenceHint: "Their name, the evaluation below, or both.",
  documentLabel: "Physician’s evaluation form",
  documentHint: "An image or PDF of the signed form.",
  documentChoose: "Choose a file",
  documentChooseAnother: "Choose a different file",
  recording: "Recording…",
  confirm: "Record the answer",
  neverMind: "Never mind",
  earlierLetterConfirm: null,
  useDiverForm: null,
};

afterEach(cleanup);

function open(copy: MedicalClearanceCopy, diverFormRecordId: string | null = null) {
  render(
    <MedicalClearanceControl
      action={() => {}}
      copy={copy}
      today="2026-10-20"
      defaultOpen
      diverFormRecordId={diverFormRecordId}
    />,
  );
}

describe("MedicalClearanceControl", () => {
  it("asks for the confirmation, unticked, naming the earlier referral", () => {
    open({
      ...COPY,
      earlierLetterConfirm: "Tick if the physician saw the referral signed Jul 18, 2026.",
    });
    const box = screen.getByRole("checkbox", { name: /referral signed Jul 18, 2026/ });
    expect(box).not.toBeChecked();
    expect(box).toHaveAttribute("name", "earlierLetterConfirmed");
  });

  it("asks nothing extra when there is no earlier referral", () => {
    open(COPY);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("offers the form the diver sent, unticked, carrying its release", () => {
    open({ ...COPY, useDiverForm: "Use the form the diver sent as the evaluation" }, "rec-1");
    const box = screen.getByRole("checkbox", {
      name: "Use the form the diver sent as the evaluation",
    });
    expect(box).not.toBeChecked();
    expect(box).toHaveAttribute("name", "diverFormRecordId");
    expect(box).toHaveAttribute("value", "rec-1");
  });
});
