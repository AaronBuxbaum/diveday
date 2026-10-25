// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { MEDICAL_ALERT_FIELD, MEDICAL_ALERT_MAX } from "@/lib/medical-alert";
import { MEDICAL_ALERT_ANCHOR, MedicalAlertSection } from "./MedicalAlertSection";
import { WAIVER_FIELD_ERROR } from "./waiver-fields";

afterEach(cleanup);

const t = diverTranslator("en-US");
const NONE = { draft: null, earlierAlert: false };

/** Issue #2960: one optional box for the crew, after the questionnaire. */
describe("MedicalAlertSection", () => {
  it("asks for the crew in its own section, optional, and says it is not the questionnaire", () => {
    render(<MedicalAlertSection prefill={NONE} minorName={null} error={undefined} t={t} />);
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
    // The one helper paragraph (visual review 2026-10-24, B56) carries every
    // safety fact the glossary's "Medical alert for the crew" asks the diver
    // page to say: not the questionnaire, nobody reviews it, who reads it, and
    // say it at the briefing too (the dock-side backstop when no reader is aboard).
    expect(screen.getByText(t("waiver.medicalAlertNotQuestionnaire"))).toBeInTheDocument();
    for (const locale of ["en-US", "es-ES"] as const) {
      expect(diverTranslator(locale)("waiver.medicalAlertNotQuestionnaire")).toMatch(
        locale === "en-US"
          ? /medical questions.*nobody reviews it.*crew can read it.*at the briefing/
          : /preguntas médicas.*nadie la revisa.*tripulación del barco.*en el briefing/,
      );
    }
    expect(document.querySelectorAll("section > p")).toHaveLength(2);
  });

  it("fills in what Save and finish later kept", () => {
    render(
      <MedicalAlertSection
        prefill={{ draft: "Bee-sting allergy. EpiPen in the blue dry bag.", earlierAlert: false }}
        minorName={null}
        error={undefined}
        t={t}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue(
      "Bee-sting allergy. EpiPen in the blue dry bag.",
    );
    expect(screen.queryByText(t("waiver.medicalAlertEarlier"))).toBeNull();
  });

  it("says the last waiver here had an alert, with an empty box and none of its words", () => {
    render(
      <MedicalAlertSection
        prefill={{ draft: null, earlierAlert: true }}
        minorName={null}
        error={undefined}
        t={t}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByText(t("waiver.medicalAlertEarlier"))).toBeInTheDocument();
    expect(t("waiver.medicalAlertEarlier")).toMatch(/write it again/);
  });

  it("says to leave it blank if there is nothing", () => {
    expect(t("waiver.medicalAlertIntro")).toMatch(/Leave it blank/);
  });

  it("counts down to the 500-character limit as the diver types", () => {
    render(
      <MedicalAlertSection
        prefill={{ draft: "Asthma.", earlierAlert: false }}
        minorName={null}
        error={undefined}
        t={t}
      />,
    );
    expect(screen.getByText("493 characters left")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a".repeat(499) } });
    expect(screen.getByText("1 character left")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(screen.getByText(`${MEDICAL_ALERT_MAX} characters left`)).toBeInTheDocument();
  });

  it("names the diver on a minor's release", () => {
    render(<MedicalAlertSection prefill={NONE} minorName="Leo Park" error={undefined} t={t} />);
    expect(
      screen.getByText(t("waiver.medicalAlertIntroMinor", { name: "Leo Park" })),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("waiver.medicalAlertIntro"))).toBeNull();
  });

  it("shows a refusal beside the box, which the page's field error names", () => {
    const refusal = t(WAIVER_FIELD_ERROR.medicalAlert.textKey);
    expect(WAIVER_FIELD_ERROR.medicalAlert.anchor).toBe(MEDICAL_ALERT_ANCHOR);
    render(<MedicalAlertSection prefill={NONE} minorName={null} error={refusal} t={t} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(refusal)).toBeInTheDocument();
  });
});
