// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { DiverChecklistItem } from "@/lib/readiness-summary";
import { SignStepActions } from "./SignStepActions";

vi.mock("../paperwork-actions", () => ({ signWaiverFromReady: async () => {} }));

/**
 * The sign step's two doors (ADR 20261008-course-forms). The forms door opens
 * on what the enrollment owes, not only on the blocker readiness raises: with
 * `COURSE_FORMS_BLOCK_BOARDING` at warn-only there is no blocker, and the
 * send's direct link was the only way in (issue #2266).
 */
const t = diverTranslator("en-US");
const formsLabel = t("ready.signCourseForms");

afterEach(cleanup);

function renderStep(courseFormsOwed: boolean, item?: DiverChecklistItem) {
  return render(
    <SignStepActions
      token="tok"
      item={item}
      courseFormsOwed={courseFormsOwed}
      actionButton="btn"
      t={t}
    />,
  );
}

describe("SignStepActions", () => {
  it("offers the forms door from owed forms alone, with no blocker raised", () => {
    renderStep(true);
    expect(screen.getByRole("link", { name: formsLabel })).toHaveAttribute(
      "href",
      "/ready/tok/forms",
    );
  });

  it("renders nothing when no form is owed and nothing blocks", () => {
    const { container } = renderStep(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("still opens the door from the blocker when the owed list says nothing", () => {
    renderStep(false, {
      code: "course_form_unsigned",
      actionable: [{ code: "course_form_unsigned" }],
    } as unknown as DiverChecklistItem);
    expect(screen.getByRole("link", { name: formsLabel })).toBeInTheDocument();
  });
});
