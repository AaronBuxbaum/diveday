// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { MEDICAL_ALERT_FIELD, MEDICAL_ALERT_MAX } from "@/lib/medical-alert";
import { MEDICAL_ALERT_ANCHOR, MedicalAlertSection } from "./MedicalAlertSection";
import { WAIVER_FIELD_ERROR } from "./waiver-fields";

afterEach(cleanup);

const t = diverTranslator("en-US");

/** Issue #2960: one optional box for the crew, after the questionnaire. */
describe("MedicalAlertSection", () => {
  it("asks for the crew in its own section, optional, and says it is not the questionnaire", () => {
    render(<MedicalAlertSection draft={null} minorName={null} error={undefined} t={t} />);
    expect(
      screen.getByRole("heading", { name: t("waiver.medicalAlertHeading") }),
    ).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: /What the crew should know/ });
    expect(box).toHaveAttribute("name", MEDICAL_ALERT_FIELD);
    expect(box).toHaveAttribute("id", MEDICAL_ALERT_ANCHOR);
    expect(box).toHaveAttribute("maxlength", String(MEDICAL_ALERT_MAX));
    expect(box).not.toBeRequired();
    expect(box).toHaveValue("");
    expect(screen.getByText(t("waiver.medicalAlertIntro"))).toBeInTheDocument();
    expect(screen.getByText(t("waiver.medicalAlertNotQuestionnaire"))).toBeInTheDocument();
  });

  it("fills in what Save and finish later kept", () => {
    render(
      <MedicalAlertSection
        draft="Bee-sting allergy. EpiPen in the blue dry bag."
        minorName={null}
        error={undefined}
        t={t}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue(
      "Bee-sting allergy. EpiPen in the blue dry bag.",
    );
  });

  it("names the diver on a minor's release", () => {
    render(<MedicalAlertSection draft={null} minorName="Leo Park" error={undefined} t={t} />);
    expect(
      screen.getByText(t("waiver.medicalAlertIntroMinor", { name: "Leo Park" })),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("waiver.medicalAlertIntro"))).toBeNull();
  });

  it("shows a refusal beside the box, which the page's field error names", () => {
    const refusal = t(WAIVER_FIELD_ERROR.medicalAlert.textKey);
    expect(WAIVER_FIELD_ERROR.medicalAlert.anchor).toBe(MEDICAL_ALERT_ANCHOR);
    render(<MedicalAlertSection draft={null} minorName={null} error={refusal} t={t} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(refusal)).toBeInTheDocument();
  });
});
